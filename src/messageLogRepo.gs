/**
 * messageLogRepo.gs — メッセージログシートの読み書き(§3.2)
 * 検索は常に末尾 CONFIG.LOG_SEARCH_TAIL_ROWS 行のみを対象とする(§3.6)。
 */

/** ログシートの末尾N行を {startRow, values} で返す */
function getLogTail_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.LOG);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { startRow: 2, values: [] };
  const startRow = Math.max(2, lastRow - CONFIG.LOG_SEARCH_TAIL_ROWS + 1);
  return {
    startRow: startRow,
    values: sheet.getRange(startRow, 1, lastRow - startRow + 1, COL.LOG.LAST).getValues()
  };
}

/**
 * メッセージログへ1行追記する(呼び出し元がロック・再試行を管理する。§4.1)。
 * record: { receivedAt, groupId, salonName, speakerType, userId, displayName,
 *           msgType, body, messageId, webhookEventId, dropboxLink, analysisStatus }
 */
function appendMessageLog_(record) {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.LOG);
  // asCellText_: 本文・表示名等のユーザー制御値による数式インジェクションと、
  // messageId・日時の自動型変換(重複排除・照合の破壊)を防ぐ
  sheet.appendRow([
    asCellText_(record.receivedAt),
    asCellText_(record.groupId),
    asCellText_(record.salonName),
    asCellText_(record.speakerType),
    asCellText_(record.userId),
    asCellText_(record.displayName),
    asCellText_(record.msgType),
    asCellText_(record.body),
    asCellText_(record.messageId),
    asCellText_(record.webhookEventId),
    asCellText_(record.dropboxLink),
    asCellText_(record.analysisStatus),
    '', // M: 分析結果JSON
    '', // N: 起票タスクID
    0   // O: 分析試行回数
  ]);
}

/**
 * 重複イベント判定(§4.1 手順3)。
 * CacheService(揮発・早期削除あり)と、永続側のメッセージログ末尾照合の二段構え。
 */
function isDuplicateEvent_(webhookEventId, messageId) {
  const cache = CacheService.getScriptCache();
  if (webhookEventId && cache.get('evt:' + webhookEventId)) return true;

  const tail = getLogTail_();
  return tail.values.some(function (row) {
    if (webhookEventId && String(row[COL.LOG.EVENT_ID - 1]) === webhookEventId) return true;
    if (messageId && String(row[COL.LOG.MESSAGE_ID - 1]) === messageId) return true;
    return false;
  });
}

/** 処理済みイベントをキャッシュに記録する(TTL 6時間) */
function markEventProcessed_(webhookEventId) {
  if (!webhookEventId) return;
  CacheService.getScriptCache().put('evt:' + webhookEventId, '1', CONFIG.DEDUPE_CACHE_TTL_SEC);
}

/** 未分析メッセージ一覧(分析バッチの処理キュー。§4.3) */
function getUnanalyzedMessages_(limit) {
  const tail = getLogTail_();
  const results = [];
  for (let i = 0; i < tail.values.length; i++) {
    const row = tail.values[i];
    if (String(row[COL.LOG.ANALYSIS_STATUS - 1]) !== STATUS.ANALYSIS.PENDING) continue;
    results.push({
      rowIndex: tail.startRow + i,
      receivedAt: String(row[COL.LOG.RECEIVED_AT - 1]),
      groupId: String(row[COL.LOG.GROUP_ID - 1]),
      salonName: String(row[COL.LOG.SALON - 1] || ''),
      speakerType: String(row[COL.LOG.SPEAKER_TYPE - 1]),
      displayName: String(row[COL.LOG.DISPLAY_NAME - 1] || ''),
      msgType: String(row[COL.LOG.MSG_TYPE - 1]),
      body: String(row[COL.LOG.BODY - 1] || ''),
      messageId: String(row[COL.LOG.MESSAGE_ID - 1]),
      dropboxLink: String(row[COL.LOG.DROPBOX_LINK - 1] || ''),
      retryCount: Number(row[COL.LOG.RETRY_COUNT - 1]) || 0
    });
    if (limit && results.length >= limit) break;
  }
  return results;
}

/** 指定グループの直近会話(古い順。自社発言・分析対象外も文脈として含む。§4.3) */
function getRecentConversation_(groupId, count) {
  if (!count || count <= 0) return []; // slice(-0)は全件になるため明示ガード
  const tail = getLogTail_();
  const rows = [];
  for (let i = 0; i < tail.values.length; i++) {
    const row = tail.values[i];
    if (String(row[COL.LOG.GROUP_ID - 1]) !== groupId) continue;
    rows.push({
      speakerType: String(row[COL.LOG.SPEAKER_TYPE - 1]),
      displayName: String(row[COL.LOG.DISPLAY_NAME - 1] || ''),
      msgType: String(row[COL.LOG.MSG_TYPE - 1]),
      body: String(row[COL.LOG.BODY - 1] || ''),
      messageId: String(row[COL.LOG.MESSAGE_ID - 1]),
      analysisStatus: String(row[COL.LOG.ANALYSIS_STATUS - 1])
    });
  }
  return rows.slice(-count);
}

/** 分析結果を記録する(L: ステータス / M: 生JSON / N: 起票タスクID) */
function setAnalysisResult_(rowIndex, status, resultJson, taskId) {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.LOG);
  sheet.getRange(rowIndex, COL.LOG.ANALYSIS_STATUS, 1, 3)
    .setValues([[status, resultJson || '', taskId || '']]);
}

/** 複数行の分析ステータスを一括更新する */
function markAnalyzed_(rowIndexes, status) {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.LOG);
  rowIndexes.forEach(function (rowIndex) {
    sheet.getRange(rowIndex, COL.LOG.ANALYSIS_STATUS).setValue(status);
  });
}

/** 分析試行回数(O列)を+1して新しい値を返す(§4.3 異常系) */
function incrementRetryCount_(rowIndex) {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.LOG);
  const cell = sheet.getRange(rowIndex, COL.LOG.RETRY_COUNT);
  const next = (Number(cell.getValue()) || 0) + 1;
  cell.setValue(next);
  return next;
}

/** K列が指定マーカーの行(動画・音声の変換待ち再取得用。§4.2 手順1) */
function getRowsByDropboxNote_(note) {
  const tail = getLogTail_();
  const results = [];
  for (let i = 0; i < tail.values.length; i++) {
    const row = tail.values[i];
    if (String(row[COL.LOG.DROPBOX_LINK - 1]) !== note) continue;
    results.push({
      rowIndex: tail.startRow + i,
      receivedAt: String(row[COL.LOG.RECEIVED_AT - 1]),
      groupId: String(row[COL.LOG.GROUP_ID - 1]),
      salonName: String(row[COL.LOG.SALON - 1] || ''),
      msgType: String(row[COL.LOG.MSG_TYPE - 1]),
      messageId: String(row[COL.LOG.MESSAGE_ID - 1]),
      taskId: String(row[COL.LOG.TASK_ID - 1] || '')
    });
  }
  return results;
}

/** K列(Dropboxリンク)を更新する(変換待ちの遅延再取得時のみ使用) */
function updateDropboxLink_(rowIndex, value) {
  getSpreadsheet_().getSheetByName(SHEET.LOG)
    .getRange(rowIndex, COL.LOG.DROPBOX_LINK).setValue(value);
}

/** 末尾N行の分析エラー件数(日次サマリの「分析失敗◯件」用。§4.3) */
function countAnalysisErrors_() {
  const tail = getLogTail_();
  return tail.values.filter(function (row) {
    return String(row[COL.LOG.ANALYSIS_STATUS - 1]) === STATUS.ANALYSIS.ERROR;
  }).length;
}
