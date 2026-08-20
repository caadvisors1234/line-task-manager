/**
 * notifier.gs — 日次サマリ・管理者通知(§4.4・§4.6)
 * 日次サマリはFlexメッセージで送信し、失敗時はテキスト版へフォールバックする。
 */

// Flexサマリの配色(墨色+アクセント1色のみ。急ぎの強調は色ではなく「急ぎ｜」+太字で行う)
const FLEX_COLOR = {
  INK: '#24292e',       // 墨色(ヘッダー帯・見出し・本文)
  INK_SOFT: '#454b52',  // 作業内容
  MUTED: '#8a9199',     // 期限・注意書き・0件表示
  ACCENT: '#06c755',    // 件数・ボタン(アクセントはこの1色に限定)
  DATE: '#c8cdd2',      // ヘッダー帯内の日付
  SEPARATOR: '#e3e6e8',
  WHITE: '#ffffff'
};
const JP_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 日次サマリを社内グループへ送信する(日次トリガー対象) */
function sendDailySummary() {
  try {
    // 土日祝・年末年始(12/29〜1/3)は送信しない。祝日一覧の取得失敗時は判定なしで送信を続行
    let holidays = {};
    try {
      holidays = fetchJpHolidays_();
    } catch (e) {
      logError_('sendDailySummary(holidays)', e);
    }
    if (isSummarySkipDay_(new Date(), holidays)) {
      console.log('土日祝・年末年始のため日次サマリをスキップしました');
      return;
    }

    const settings = getSettings_();

    // 通数残量チェック(§4.4 手順1)。取得失敗時はチェックをスキップして送信は続行
    const consumption = fetchQuotaConsumption_();
    if (consumption !== null && consumption > settings.quotaWarnThreshold) {
      notifyAdmin_(
        '【警告】LINE通数が今月 ' + consumption + ' 通に達しています(しきい値: ' +
        settings.quotaWarnThreshold + ' 通/上限: 5,000通)。上限到達時は日次サマリが停止します。',
        'quota'
      );
    }

    // 対象窓は「前回送信時刻 < 起票日時 <= 今回上限」で、取りこぼし・二重通知が出ない。
    // 上限はシート読み取り前に確定し、60秒のマージンを引く: 起票側(createTask_)は
    // R列の採時→行の追加の順で、別実行が追加した行の可視化には遅延があり得るため、
    // 「採時済みだが読み取り時点で未可視」の行が窓から永久に漏れるのを防ぐ
    // (上限直前の到着は従来どおり翌営業日に繰り越されるだけで、漏れない)
    const now = new Date();
    const until = new Date(now.getTime() - 60 * 1000);
    const untilStr = formatDateTime_(until);
    // プロパティが手動編集等で不正書式になっていたら初回同様のフォールバックで自己回復する
    // (人手で直すまで毎営業日エラー停止し続けるのを防ぐ。1回分の重複通知は許容)
    const lastSentStr = getProp_(CONFIG.PROP.SUMMARY_LAST_SENT_AT);
    let since;
    if (lastSentStr && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(lastSentStr)) {
      since = parseDateTime_(lastSentStr);
    } else {
      if (lastSentStr) {
        logError_('sendDailySummary(lastSentAt)',
          new Error(CONFIG.PROP.SUMMARY_LAST_SENT_AT + ' が不正な書式のため前営業日10:00で代替します: ' + lastSentStr));
      }
      since = fallbackLastSentAt_(now, holidays);
    }

    const tasks = getTasksForSummary_(formatDateTime_(since), untilStr);
    const options = {
      now: now,
      since: since,
      dueSoonDays: settings.dueSoonDays,
      maxItems: settings.summaryMaxItems,
      // 分析失敗は前回サマリ以降の発生分のみ通知する。エラー確定は受信から最大35分ほど
      // 遅れるため、タスクと同じ窓では送信直前受信→送信後確定の行が漏れる。窓全体を
      // SUMMARY_ERROR_WINDOW_LAG_MS だけ過去へずらして数える(窓は連続し漏れ・重複なし)
      errorCount: countAnalysisErrors_(
        formatDateTime_(new Date(since.getTime() - CONFIG.SUMMARY_ERROR_WINDOW_LAG_MS)),
        formatDateTime_(new Date(until.getTime() - CONFIG.SUMMARY_ERROR_WINDOW_LAG_MS))
      ),
      unnamedGroupCount: countUnnamedActiveGroups_(),
      sheetUrl: externalBrowserUrl_(getSpreadsheet_().getUrl())
    };
    const groupId = getProp_(CONFIG.PROP.SUMMARY_GROUP_ID);
    if (!groupId) throw new Error(CONFIG.PROP.SUMMARY_GROUP_ID + ' が未設定です');

    // Flex送信→失敗時はテキスト版で再送→それも失敗なら外側catchで管理者通知(§4.4異常系)。
    // 「5xx応答だが実は配信済み」の稀なケースではFlexとテキストが二重に届き得る
    // (pushMessage_のリトライと同水準のリスクとして許容)
    let flexSent = false;
    try {
      const flex = buildSummaryFlex_(tasks, options);
      const flexBytes = Utilities.newBlob(JSON.stringify(flex.contents)).getBytes().length;
      if (flexBytes > CONFIG.FLEX_SIZE_LIMIT_BYTES) {
        // 上限30KBへの接近は設定「サマリ各区分の最大表示件数」の上げすぎ等。テキスト版で送る
        logError_('sendDailySummary(flex)',
          new Error('Flex JSONがサイズ上限を超過(' + flexBytes + ' bytes)。テキスト版で送信します'));
      } else {
        pushMessage_(groupId, [{ type: 'flex', altText: flex.altText, contents: flex.contents }]);
        flexSent = true;
      }
    } catch (e) {
      logError_('sendDailySummary(flex)', e);
    }
    if (!flexSent) {
      pushMessage_(groupId, [{ type: 'text', text: buildSummaryText_(tasks, options) }]);
    }

    // ここに到達した時点でFlexかテキスト版のいずれかは送信済み(pushMessage_は失敗時throw)。
    // 最終送信日時の保存失敗は翌営業日の重複通知で済むため、外側catchへ抜けて
    // 「送信失敗」の管理者通知が飛ばないようここで握る
    try {
      setProp_(CONFIG.PROP.SUMMARY_LAST_SENT_AT, untilStr);
    } catch (e) {
      logError_('sendDailySummary(saveLastSentAt)', e);
    }
  } catch (e) {
    logError_('sendDailySummary', e);
    notifyAdmin_(
      '【エラー】日次サマリの送信に失敗しました: ' + e.message +
      '\nタスクはスプレッドシートから直接確認してください。',
      'summary_fail'
    );
  }
}

/**
 * 日本の祝日一覧を holidays-jp API(内閣府データ由来)から取得する(前年〜翌年分)。
 * 戻り値: { 'yyyy-MM-dd': 祝日名 }。失敗時はthrow(呼び出し側で握って送信を続行する)
 */
function fetchJpHolidays_() {
  const response = fetchWithRetry_(CONFIG.HOLIDAYS_JP_URL, {});
  if (response.getResponseCode() !== 200) {
    throw new Error('holidays-jp APIの取得に失敗しました(HTTP ' + response.getResponseCode() + ')');
  }
  const holidays = JSON.parse(response.getContentText());
  // JSON.parse('null') 等はthrowしないため、オブジェクト以外は取得失敗として扱う
  if (!holidays || typeof holidays !== 'object') {
    throw new Error('holidays-jp APIの応答が想定外の形式です');
  }
  return holidays;
}

/**
 * 日次サマリを送信しない日か判定する純関数(土日・祝日・年末年始12/29〜1/3)。
 * holidays: fetchJpHolidays_() の戻り値({ 'yyyy-MM-dd': 祝日名 })
 */
function isSummarySkipDay_(date, holidays) {
  const weekday = Utilities.formatDate(date, CONFIG.TIMEZONE, 'u'); // 1=月〜7=日
  if (weekday === '6' || weekday === '7') return true;
  if (holidays[formatDate_(date)]) return true;
  const monthDay = Utilities.formatDate(date, CONFIG.TIMEZONE, 'MM-dd');
  return monthDay >= '12-29' || monthDay <= '01-03';
}

/**
 * SUMMARY_LAST_SENT_AT 未設定時(初回実行)のフォールバック(純関数)。
 * isSummarySkipDay_ で土日祝・年末年始を遡り、直近の前営業日の10:00を返す
 * (固定の「24時間前」では月曜初回に土日到着分を取りこぼすため)。
 * 遡りは最大14日(祝日一覧が壊れていても無限ループしない安全弁)。
 */
function fallbackLastSentAt_(now, holidays) {
  const d = new Date(now.getTime());
  for (let i = 0; i < 14; i++) {
    d.setDate(d.getDate() - 1);
    if (!isSummarySkipDay_(d, holidays)) break;
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0, 0);
}

/**
 * [急ぎ]判定(純関数)。緊急度(N列・AI判定)が「高」、または期限(S列)が dueLimit 以下。
 * タスク状況(H列)は先方が更新しない運用のため判定に使わない(§4.4)。
 * dueLimit: formatDatePlusDays_(now, dueSoonDays) の yyyy-MM-dd(辞書順比較)
 */
function isUrgentTask_(t, dueLimit) {
  return t.urgency === URGENCY.HIGH || (t.dueDate !== '' && t.dueDate <= dueLimit);
}

/** 起票日時(yyyy-MM-dd HH:mm:ss)の昇順=到着順に並べた新しい配列を返す(純関数) */
function sortByCreatedAtAsc_(tasks) {
  return tasks.slice().sort(function (a, b) {
    return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
  });
}

/** 'M/d(曜)' 形式(Utilities.formatDateの曜日'E'は英語表記になるため日本語曜日を自前で引く) */
function formatDayLabel_(date) {
  const weekday = JP_WEEKDAYS[Number(Utilities.formatDate(date, CONFIG.TIMEZONE, 'u')) % 7];
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'M/d') + '(' + weekday + ')';
}

/** 対象範囲の起点表示 'M/d(曜) H:mm' */
function formatSinceLabel_(date) {
  return formatDayLabel_(date) + ' ' + Utilities.formatDate(date, CONFIG.TIMEZONE, 'H:mm');
}

/** R列の起票日時文字列 → 'M/d H:mm'(一覧行の到着時刻表示) */
function formatCreatedShort_(createdAtStr) {
  return Utilities.formatDate(parseDateTime_(createdAtStr), CONFIG.TIMEZONE, 'M/d H:mm');
}

/**
 * 新着連絡サマリ本文を組み立てる純関数(§4.4。絵文字なし)。
 * Flex送信に失敗した場合のフォールバック用として維持する。
 * tasks: getTasksForSummary_() の戻り値
 * options: { now, since, dueSoonDays, maxItems, errorCount, unnamedGroupCount, sheetUrl }
 */
function buildSummaryText_(tasks, options) {
  const sorted = sortByCreatedAtAsc_(tasks);
  const dueLimit = formatDatePlusDays_(options.now, options.dueSoonDays);

  const lines = [];
  lines.push('新着連絡サマリ(' + formatDayLabel_(options.now) + ' 10:00ごろ)');
  if (sorted.length === 0) {
    // 0件の営業日も送る(Botの生存確認を兼ねる)
    lines.push('対象: ' + formatSinceLabel_(options.since) + ' 以降の新着はありません');
  } else {
    lines.push('対象: ' + formatSinceLabel_(options.since) + ' 以降の新着 ' + sorted.length + '件');
    lines.push('');
    appendTaskLines_(lines, sorted, options.maxItems, function (t) {
      return formatArrivalLine_(t, isUrgentTask_(t, dueLimit));
    });
  }

  if (options.errorCount > 0) {
    lines.push('分析失敗' + options.errorCount + '件(メッセージログを確認してください)');
  }
  if (options.unnamedGroupCount > 0) {
    lines.push('※サロン名未設定のグループが' + options.unnamedGroupCount + '件あります(顧客マスタに記入してください)');
  }
  lines.push('詳細: ' + options.sheetUrl);
  return lines.join('\n');
}

/** 1タスク1行: 到着時刻|サロン名|作業内容(対応期日)[急ぎ] ※要確認 */
function formatArrivalLine_(t, urgent) {
  let line = formatCreatedShort_(t.createdAt) + '|' + (t.salonName || '(サロン名未設定)') + '|' + t.summary;
  if (t.dueText) line += '(' + t.dueText + ')';
  if (urgent) line += '[急ぎ]';
  if (t.needsReview) line += ' ※要確認';
  return line;
}

/** 最大表示件数で切り詰める(5,000文字対策。§4.4 手順4) */
function appendTaskLines_(lines, tasks, maxItems, formatter) {
  tasks.slice(0, maxItems).forEach(function (t) { lines.push(formatter(t)); });
  if (tasks.length > maxItems) {
    lines.push('ほか' + (tasks.length - maxItems) + '件はシート参照');
  }
}

/**
 * 新着連絡サマリのFlexメッセージを組み立てる純関数(§4.4)。
 * 戻り値: { altText, contents }(送信時は { type:'flex', altText, contents } に組む)。
 * 注意: Flexのtextコンポーネントに空文字を渡すとHTTP 400になるため、
 * 空になり得る行はコンポーネント自体を生成しない。
 */
function buildSummaryFlex_(tasks, options) {
  const sorted = sortByCreatedAtAsc_(tasks);
  const dueLimit = formatDatePlusDays_(options.now, options.dueSoonDays);
  const dateLabel = Utilities.formatDate(options.now, CONFIG.TIMEZONE, 'M/d');

  const body = [];
  body.push({
    type: 'box', layout: 'horizontal', margin: 'md', contents: [
      flexText_(formatSinceLabel_(options.since) + ' 以降の新着', {
        size: 'sm', color: FLEX_COLOR.INK, flex: 1, wrap: true
      }),
      flexText_(sorted.length + '件', {
        weight: 'bold', size: 'sm', align: 'end', flex: 0,
        color: sorted.length > 0 ? FLEX_COLOR.ACCENT : FLEX_COLOR.MUTED
      })
    ]
  });
  body.push(flexSeparator_());
  if (sorted.length === 0) {
    // 0件の営業日も送る(Botの生存確認を兼ねる)
    body.push(flexText_('新着の連絡はありません', { size: 'sm', color: FLEX_COLOR.MUTED, margin: 'md' }));
  } else {
    sorted.slice(0, options.maxItems).forEach(function (t) {
      body.push(flexTaskItem_(t, isUrgentTask_(t, dueLimit)));
    });
    if (sorted.length > options.maxItems) {
      body.push(flexText_('ほか' + (sorted.length - options.maxItems) + '件はシート参照',
        { size: 'xs', color: FLEX_COLOR.MUTED, margin: 'sm' }));
    }
  }
  if (options.errorCount > 0) {
    body.push(flexText_('分析失敗' + options.errorCount + '件(メッセージログを確認してください)',
      { size: 'xs', color: FLEX_COLOR.MUTED, margin: 'md', wrap: true }));
  }
  if (options.unnamedGroupCount > 0) {
    body.push(flexText_(
      '※サロン名未設定のグループが' + options.unnamedGroupCount + '件あります(顧客マスタに記入してください)',
      { size: 'xs', color: FLEX_COLOR.MUTED, margin: 'sm', wrap: true }));
  }

  const contents = {
    type: 'bubble',
    styles: {
      header: { backgroundColor: FLEX_COLOR.INK },
      footer: { separator: true, separatorColor: FLEX_COLOR.SEPARATOR }
    },
    header: {
      type: 'box', layout: 'vertical', contents: [
        flexText_('新着連絡サマリ', { color: FLEX_COLOR.WHITE, weight: 'bold', size: 'md' }),
        flexText_(formatDayLabel_(options.now) + ' 10:00ごろ', { color: FLEX_COLOR.DATE, size: 'xs', margin: 'xs' })
      ]
    },
    body: { type: 'box', layout: 'vertical', contents: body },
    footer: {
      type: 'box', layout: 'vertical', contents: [{
        type: 'button', style: 'primary', color: FLEX_COLOR.ACCENT, height: 'sm',
        action: { type: 'uri', label: 'タスク一覧を開く', uri: options.sheetUrl }
      }]
    }
  };

  // 通知欄・トーク一覧に出る要約(仕様上限1,500字。件数だけをひと目で判断できる短文にする)
  const altText = sorted.length > 0
    ? '新着連絡サマリ(' + dateLabel + ') 新着' + sorted.length + '件'
    : '新着連絡サマリ(' + dateLabel + ') 新着はありません';
  return { altText: altText, contents: contents };
}

/** 1タスク分の縦box: サロン名([急ぎ]は「急ぎ｜」接頭辞+太字で強調)／作業内容／受信時刻・期限・要確認 */
function flexTaskItem_(t, urgent) {
  const salon = t.salonName || '(サロン名未設定)';
  const title = (urgent ? '急ぎ｜' : '') + salon;
  const contents = [flexText_(title, { weight: 'bold', size: 'sm', color: FLEX_COLOR.INK, wrap: true })];
  if (t.summary) {
    contents.push(flexText_(t.summary, { size: 'sm', color: FLEX_COLOR.INK_SOFT, wrap: true }));
  }
  // 受信時刻が必ず入るため、meta行が空文字textになることはない(HTTP 400対策)
  const subParts = ['受信 ' + formatCreatedShort_(t.createdAt)];
  if (t.dueText) subParts.push('期限: ' + t.dueText);
  if (t.needsReview) subParts.push('※要確認');
  contents.push(flexText_(subParts.join(' '), { size: 'xs', color: FLEX_COLOR.MUTED, margin: 'xs', wrap: true }));
  return { type: 'box', layout: 'vertical', margin: 'md', contents: contents };
}

/**
 * LINE内ブラウザではなく端末の標準ブラウザで開くためのパラメータを付与する
 * (LINEのURLスキーム openExternalBrowser=1。LINE内ブラウザはGoogle未ログインのため、
 * スプレッドシートを開くとログイン画面に遷移してしまう対策)
 */
function externalBrowserUrl_(url) {
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 'openExternalBrowser=1';
}

/** textコンポーネントを組む(propsをそのままマージ) */
function flexText_(text, props) {
  const component = { type: 'text', text: text };
  Object.keys(props || {}).forEach(function (key) { component[key] = props[key]; });
  return component;
}

function flexSeparator_() {
  return { type: 'separator', margin: 'lg', color: FLEX_COLOR.SEPARATOR };
}

/**
 * 管理者グループへの通知(§4.6)。
 * typeKey で同一種別を1時間に1回に抑制する。本処理を殺さないよう例外は外へ投げない。
 */
function notifyAdmin_(message, typeKey) {
  try {
    if (typeKey && CacheService.getScriptCache().get('notif:' + typeKey)) return;
    const groupId = getProp_(CONFIG.PROP.ADMIN_GROUP_ID);
    if (!groupId) {
      console.error('notifyAdmin_: ' + CONFIG.PROP.ADMIN_GROUP_ID + ' 未設定のため通知スキップ: ' + message);
      return;
    }
    pushMessage_(groupId, [{ type: 'text', text: message }]);
    // 抑制キャッシュは送信成功後にセットする(送信失敗時に通知が1時間消えるのを防ぐ)
    if (typeKey) {
      CacheService.getScriptCache().put('notif:' + typeKey, '1', CONFIG.ADMIN_NOTIFY_SUPPRESS_SEC);
    }
  } catch (e) {
    console.error('notifyAdmin_ 失敗: ' + e.message);
  }
}
