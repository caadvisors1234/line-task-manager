/**
 * taskRepo.gs — タスク一覧シートの読み書き(§3.1)
 *
 * 手動記入の保護(§3.1「書き込み保護」): 汎用の列更新関数を持たず、書き込みAPIを
 *   1. createTask_        — 新規行の追加のみ(B: 納品データ / C: 担当者名 は常に空で作成)
 *   2. appendAttachmentLink_ — 既存行のG列(議事録・添付資料)への「追記」のみ
 * の2つに限定することで、B・C列および既存行のA・H列への書き込みを構造的に禁止する。
 */

/** タスクIDを採番する(T-0001形式)。必ずScriptLock内から呼ぶこと */
function issueTaskId_() {
  const props = PropertiesService.getScriptProperties();
  const next = (parseInt(props.getProperty(CONFIG.PROP.TASK_ID_SEQ), 10) || 0) + 1;
  props.setProperty(CONFIG.PROP.TASK_ID_SEQ, String(next));
  return 'T-' + String(next).padStart(4, '0');
}

/**
 * タスクを起票する(新規行の追加のみ。既存行は更新しない。§4.3)。
 * task: { dueText, salonName, msgType, summary, attachmentLink, status, createdLabel,
 *         originalText, replyDraft, groupId, urgency, relatedTaskId, needsReview,
 *         sourceMessageId, dueDate }
 * sourceMessageId は、関連メッセージをまとめて起票した場合は複数IDのカンマ連結になる(§4.3)。
 * 戻り値: 採番したタスクID
 */
function createTask_(task) {
  return withScriptLock_(function () {
    const taskId = issueTaskId_();
    const sheet = getSpreadsheet_().getSheetByName(SHEET.TASK);
    // asCellText_: AI出力・メッセージ由来の値による数式インジェクションと自動型変換を防ぐ
    sheet.appendRow([
      asCellText_(task.dueText),     // A: 対応期日(AI初期値のみ)
      '',                            // B: 納品データ(Bot書き込み禁止)
      '',                            // C: 担当者名(Bot書き込み禁止)
      asCellText_(task.salonName),   // D: 店舗名
      asCellText_(task.msgType),     // E: メッセージ種別
      asCellText_(task.summary),     // F: 作業内容
      asCellText_(task.attachmentLink), // G: 議事録・添付資料
      asCellText_(task.status || STATUS.TASK.TODO), // H: タスク状況(初期値のみ)
      asCellText_(task.createdLabel), // I: タスク発生日
      asCellText_(truncateForCell_(task.originalText)), // J: 元の連絡文
      asCellText_(task.replyDraft),  // K: 返信提案
      asCellText_(taskId),           // L: タスクID
      asCellText_(task.groupId),     // M: グループID
      asCellText_(task.urgency),     // N: 緊急度
      asCellText_(task.relatedTaskId), // O: 関連タスクID
      task.needsReview ? '要確認' : '', // P: 要確認フラグ
      asCellText_(task.sourceMessageId), // Q: 起票元messageId
      asCellText_(formatDateTime_(new Date())), // R: 起票日時
      asCellText_(task.dueDate)      // S: 期限(yyyy-MM-dd)
    ]);
    return taskId;
  });
}

/** タスク一覧の全データ行を返す(内部用) */
function getTaskRows_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.TASK);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, COL.TASK.LAST).getValues();
}

/** 未完了判定(「タスク完了済み」「対象外」以外。§4.4) */
function isOpenStatus_(status) {
  return status !== STATUS.TASK.COMPLETED && status !== STATUS.TASK.EXCLUDED;
}

/** 指定サロンの未完了タスク(Geminiへ渡す文脈用。§4.3) */
function getOpenTasksBySalon_(salonName) {
  return getTaskRows_()
    .filter(function (row) {
      return String(row[COL.TASK.SALON - 1]) === salonName &&
        isOpenStatus_(String(row[COL.TASK.STATUS - 1]));
    })
    .map(function (row) {
      return {
        taskId: String(row[COL.TASK.TASK_ID - 1]),
        summary: String(row[COL.TASK.SUMMARY - 1] || ''),
        status: String(row[COL.TASK.STATUS - 1])
      };
    });
}

/** 日次サマリ用の全未完了タスク(§4.4) */
function getTasksForSummary_() {
  return getTaskRows_()
    .filter(function (row) { return isOpenStatus_(String(row[COL.TASK.STATUS - 1])); })
    .map(function (row) {
      return {
        taskId: String(row[COL.TASK.TASK_ID - 1]),
        dueText: String(row[COL.TASK.DUE_TEXT - 1] || ''),
        salonName: String(row[COL.TASK.SALON - 1] || ''),
        summary: String(row[COL.TASK.SUMMARY - 1] || ''),
        status: String(row[COL.TASK.STATUS - 1]),
        needsReview: String(row[COL.TASK.NEEDS_REVIEW - 1] || '') !== '',
        dueDate: String(row[COL.TASK.DUE_DATE - 1] || '')
      };
    });
}

/**
 * 起票元messageIdによる既存タスク照合(再起票防止。§4.3)。
 * 関連メッセージのまとめ起票によりQ列は複数IDのカンマ連結になり得るため、
 * カンマ分割して完全一致で照合する(TextFinderの部分一致ではID同士の誤検出が起こるため)。
 * messageIds のいずれか1つでも既存タスクの起票元に含まれていれば、そのタスクIDを返す。
 */
function findTaskBySourceMessageIds_(messageIds) {
  const targets = (messageIds || []).filter(function (id) { return !!id; });
  if (targets.length === 0) return null;
  const rows = getTaskRows_();
  for (let i = 0; i < rows.length; i++) {
    const sourceIds = String(rows[i][COL.TASK.SOURCE_MESSAGE_ID - 1]).split(',');
    const hit = targets.some(function (id) { return sourceIds.indexOf(id) !== -1; });
    if (hit) return String(rows[i][COL.TASK.TASK_ID - 1]);
  }
  return null;
}

/**
 * 既存タスクのG列(議事録・添付資料)へリンクを追記する(§3.1)。
 * 既存セル内容は上書きせず、改行して追加する。
 */
function appendAttachmentLink_(taskId, url) {
  if (!taskId || !url) return false;
  return withScriptLock_(function () {
    const sheet = getSpreadsheet_().getSheetByName(SHEET.TASK);
    const found = sheet.getRange(2, COL.TASK.TASK_ID, Math.max(sheet.getLastRow() - 1, 1), 1)
      .createTextFinder(taskId).matchEntireCell(true).findNext();
    if (!found) return false;
    const cell = sheet.getRange(found.getRow(), COL.TASK.ATTACHMENT);
    const current = String(cell.getValue() || '');
    cell.setValue(asCellText_(current ? current + '\n' + url : url));
    return true;
  });
}
