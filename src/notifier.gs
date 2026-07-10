/**
 * notifier.gs — 日次サマリ・管理者通知(§4.4・§4.6)
 */

/** 日次サマリを社内グループへ送信する(日次トリガー対象) */
function sendDailySummary() {
  try {
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

    const text = buildSummaryText_(getTasksForSummary_(), {
      now: new Date(),
      dueSoonDays: settings.dueSoonDays,
      maxItems: settings.summaryMaxItems,
      errorCount: countAnalysisErrors_(),
      unnamedGroupCount: countUnnamedActiveGroups_(),
      sheetUrl: getSpreadsheet_().getUrl()
    });

    const groupId = getProp_(CONFIG.PROP.SUMMARY_GROUP_ID);
    if (!groupId) throw new Error(CONFIG.PROP.SUMMARY_GROUP_ID + ' が未設定です');
    pushMessage_(groupId, [{ type: 'text', text: text }]);
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
 * サマリ本文を組み立てる純関数(§4.4 の承認版フォーマット。絵文字なし)。
 * tasks: getTasksForSummary_() の戻り値
 * options: { now, dueSoonDays, maxItems, errorCount, unnamedGroupCount, sheetUrl }
 */
function buildSummaryText_(tasks, options) {
  const dueLimit = formatDatePlusDays_(options.now, options.dueSoonDays);

  // 区分1: 急ぎ・期限間近(タスク状況「急ぎの対応」+ 期限がN日以内。R列で判定。期限昇順)
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

  const lines = [];
  lines.push('本日のタスクサマリ(' + Utilities.formatDate(options.now, CONFIG.TIMEZONE, 'M/d') + ' 9:00頃)');

  lines.push('── 急ぎ・期限間近 ' + urgentTasks.length + '件 ──');
  appendTaskLines_(lines, urgentTasks, options.maxItems, function (t) {
    return (t.status === STATUS.TASK.URGENT ? '[急ぎ] ' : '[期限] ') + formatTaskLine_(t);
  });

  lines.push('── 未対応・依頼中 ' + pendingTasks.length + '件 ──');
  appendTaskLines_(lines, pendingTasks, options.maxItems, formatTaskLine_);

  lines.push('── お客様連絡待ち ' + awaitingCustomer + '件|反映待ち ' + awaitingApply + '件 ──');

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
