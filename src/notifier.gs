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

    const tasks = getTasksForSummary_();
    const options = {
      now: new Date(),
      dueSoonDays: settings.dueSoonDays,
      maxItems: settings.summaryMaxItems,
      errorCount: countAnalysisErrors_(),
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
 * サマリの区分集計(純関数)。テキスト版とFlex版で共有する(§4.4 手順2)。
 * tasks: getTasksForSummary_() の戻り値
 * options: { now, dueSoonDays, ... }
 * 戻り値: { urgentTasks, pendingTasks, awaitingCustomer, awaitingApply }
 */
function summarizeTasks_(tasks, options) {
  const dueLimit = formatDatePlusDays_(options.now, options.dueSoonDays);

  // 区分1: 急ぎ・期限間近(タスク状況「急ぎの対応」+ 期限がN日以内。S列で判定。期限昇順)
  const urgentTasks = tasks.filter(function (t) {
    return t.status === STATUS.TASK.URGENT || (t.dueDate && t.dueDate <= dueLimit);
  });
  urgentTasks.sort(function (a, b) {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1; // 期限なし(急ぎのみ)は後ろ
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : (a.dueDate > b.dueDate ? 1 : 0);
  });
  const urgentIds = {};
  urgentTasks.forEach(function (t) { urgentIds[t.taskId] = true; });

  // 区分2: 未対応・依頼中(区分1に出したものは重複表示しない)
  const pendingTasks = tasks.filter(function (t) {
    return (t.status === STATUS.TASK.TODO || t.status === STATUS.TASK.REQUESTED) &&
      !urgentIds[t.taskId];
  });

  // 区分3: 件数のみ
  const awaitingCustomer = tasks.filter(function (t) { return t.status === STATUS.TASK.AWAITING_CUSTOMER; }).length;
  const awaitingApply = tasks.filter(function (t) { return t.status === STATUS.TASK.AWAITING_APPLY; }).length;

  return {
    urgentTasks: urgentTasks,
    pendingTasks: pendingTasks,
    awaitingCustomer: awaitingCustomer,
    awaitingApply: awaitingApply
  };
}

/**
 * サマリ本文を組み立てる純関数(§4.4 の承認版フォーマット。絵文字なし)。
 * Flex送信に失敗した場合のフォールバック用として維持する。
 * tasks: getTasksForSummary_() の戻り値
 * options: { now, dueSoonDays, maxItems, errorCount, unnamedGroupCount, sheetUrl }
 */
function buildSummaryText_(tasks, options) {
  const summary = summarizeTasks_(tasks, options);

  const lines = [];
  lines.push('本日のタスクサマリ(' + Utilities.formatDate(options.now, CONFIG.TIMEZONE, 'M/d') + ' 10:00頃)');

  lines.push('── 急ぎ・期限間近 ' + summary.urgentTasks.length + '件 ──');
  appendTaskLines_(lines, summary.urgentTasks, options.maxItems, function (t) {
    return (t.status === STATUS.TASK.URGENT ? '[急ぎ] ' : '[期限] ') + formatTaskLine_(t);
  });

  lines.push('── 未対応・依頼中 ' + summary.pendingTasks.length + '件 ──');
  appendTaskLines_(lines, summary.pendingTasks, options.maxItems, formatTaskLine_);

  lines.push('── お客様連絡待ち ' + summary.awaitingCustomer + '件|反映待ち ' + summary.awaitingApply + '件 ──');

  if (options.errorCount > 0) {
    lines.push('分析失敗' + options.errorCount + '件(メッセージログを確認してください)');
  }
  if (options.unnamedGroupCount > 0) {
    lines.push('※サロン名未設定のグループが' + options.unnamedGroupCount + '件あります(顧客マスタに記入してください)');
  }
  lines.push('詳細: ' + options.sheetUrl);
  return lines.join('\n');
}

/** 1タスク1行: サロン名|作業内容(対応期日)※要確認 */
function formatTaskLine_(t) {
  let line = t.salonName + '|' + t.summary;
  if (t.dueText) line += '(' + t.dueText + ')';
  if (t.needsReview) line += ' ※要確認';
  return line;
}

/** 区分ごとの最大表示件数で切り詰める(5,000文字対策。§4.4 手順4) */
function appendTaskLines_(lines, tasks, maxItems, formatter) {
  tasks.slice(0, maxItems).forEach(function (t) { lines.push(formatter(t)); });
  if (tasks.length > maxItems) {
    lines.push('ほか' + (tasks.length - maxItems) + '件はシート参照');
  }
}

/**
 * 日次サマリのFlexメッセージを組み立てる純関数(§4.4)。
 * 戻り値: { altText, contents }(送信時は { type:'flex', altText, contents } に組む)。
 * 注意: Flexのtextコンポーネントに空文字を渡すとHTTP 400になるため、
 * 空になり得る行はコンポーネント自体を生成しない。
 */
function buildSummaryFlex_(tasks, options) {
  const summary = summarizeTasks_(tasks, options);
  const dateLabel = Utilities.formatDate(options.now, CONFIG.TIMEZONE, 'M/d');
  // Utilities.formatDateの曜日(E)は英語表記になるため日本語曜日は自前で引く('u'は1=月〜7=日)
  const weekday = JP_WEEKDAYS[Number(Utilities.formatDate(options.now, CONFIG.TIMEZONE, 'u')) % 7];

  const body = [];
  appendFlexSection_(body, '急ぎ・期限間近', summary.urgentTasks, options.maxItems, true);
  body.push(flexSeparator_());
  appendFlexSection_(body, '未対応・依頼中', summary.pendingTasks, options.maxItems, false);
  body.push(flexSeparator_());
  body.push(flexText_(
    'お客様連絡待ち ' + summary.awaitingCustomer + '件｜反映待ち ' + summary.awaitingApply + '件',
    { size: 'sm', color: FLEX_COLOR.INK, margin: 'md' }
  ));
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
        flexText_('本日のタスクサマリ', { color: FLEX_COLOR.WHITE, weight: 'bold', size: 'md' }),
        flexText_(dateLabel + '(' + weekday + ') 10:00ごろ', { color: FLEX_COLOR.DATE, size: 'xs', margin: 'xs' })
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
  const altText = '本日のタスクサマリ(' + dateLabel + ') 急ぎ・期限間近' + summary.urgentTasks.length +
    '件／未対応・依頼中' + summary.pendingTasks.length + '件';
  return { altText: altText, contents: contents };
}

/** 区分見出し(名称+件数)とタスク行をbodyへ追加する。切り詰め規則はテキスト版と同じ */
function appendFlexSection_(target, title, tasks, maxItems, withLabel) {
  target.push({
    type: 'box', layout: 'horizontal', margin: 'md', contents: [
      flexText_(title, { weight: 'bold', size: 'sm', color: FLEX_COLOR.INK, flex: 1 }),
      flexText_(tasks.length + '件', {
        weight: 'bold', size: 'sm', align: 'end', flex: 0,
        color: tasks.length > 0 ? FLEX_COLOR.ACCENT : FLEX_COLOR.MUTED
      })
    ]
  });
  if (tasks.length === 0) {
    target.push(flexText_('なし', { size: 'sm', color: FLEX_COLOR.MUTED, margin: 'sm' }));
    return;
  }
  tasks.slice(0, maxItems).forEach(function (t) {
    target.push(flexTaskItem_(t, withLabel));
  });
  if (tasks.length > maxItems) {
    target.push(flexText_('ほか' + (tasks.length - maxItems) + '件はシート参照',
      { size: 'xs', color: FLEX_COLOR.MUTED, margin: 'sm' }));
  }
}

/** 1タスク分の縦box: サロン名(急ぎ・期限ラベル付き)／作業内容／期限・要確認 */
function flexTaskItem_(t, withLabel) {
  const salon = t.salonName || '(サロン名未設定)';
  const title = withLabel
    ? (t.status === STATUS.TASK.URGENT ? '急ぎ｜' : '期限｜') + salon
    : salon;
  const contents = [flexText_(title, { weight: 'bold', size: 'sm', color: FLEX_COLOR.INK, wrap: true })];
  if (t.summary) {
    contents.push(flexText_(t.summary, { size: 'sm', color: FLEX_COLOR.INK_SOFT, wrap: true }));
  }
  const subParts = [];
  if (t.dueText) subParts.push('期限: ' + t.dueText);
  if (t.needsReview) subParts.push('※要確認');
  if (subParts.length > 0) {
    contents.push(flexText_(subParts.join(' '), { size: 'xs', color: FLEX_COLOR.MUTED, margin: 'xs' }));
  }
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
