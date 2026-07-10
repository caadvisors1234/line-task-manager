/**
 * utils.gs — 共通処理(ロック・HTTP・日付・エラーログ)
 */

// 実行内メモ化(グローバルスコープは毎実行初期化されるため、1実行内のみ有効)
let spreadsheetMemo_ = null;

/** 対象スプレッドシートを返す(実行内メモ化) */
function getSpreadsheet_() {
  if (!spreadsheetMemo_) {
    const id = getProp_(CONFIG.PROP.SPREADSHEET_ID);
    if (!id) {
      throw new Error('スクリプトプロパティ ' + CONFIG.PROP.SPREADSHEET_ID + ' が未設定です');
    }
    spreadsheetMemo_ = SpreadsheetApp.openById(id);
  }
  return spreadsheetMemo_;
}

/** スクリプトプロパティの値を返す(未設定ならnull) */
function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/**
 * ScriptLock保護下で処理を実行する。§7-17
 * ロック区間は最小化すること(シート追記・採番のみ。外部API呼び出しをロック内に入れない)。
 */
function withScriptLock_(fn, timeoutMs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(timeoutMs || CONFIG.LOCK_TIMEOUT_MS); // 取得失敗は例外
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 失敗時に再試行する(doPost内のロック取得・シート追記用。§4.1) */
function withRetry_(fn, maxAttempts, sleepMs) {
  const attempts = maxAttempts || CONFIG.DOPOST_MAX_RETRY;
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) Utilities.sleep(sleepMs || 500);
    }
  }
  throw lastError;
}

/**
 * UrlFetchApp.fetch のラッパ。常に muteHttpExceptions で呼び、
 * 429/5xx とネットワーク例外(DNS失敗・タイムアウト等)は指数バックオフで再試行する。
 * 4xx(429以外)は呼び出し元が判定する。
 */
function fetchWithRetry_(url, params, maxRetry) {
  const retries = maxRetry === undefined ? 2 : maxRetry;
  const options = Object.assign({}, params, { muteHttpExceptions: true });
  let response = null;
  for (let i = 0; i <= retries; i++) {
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (e) {
      if (i === retries) throw e;
      Utilities.sleep(1000 * Math.pow(2, i));
      continue;
    }
    const code = response.getResponseCode();
    if (code !== 429 && code < 500) return response;
    if (i < retries) Utilities.sleep(1000 * Math.pow(2, i)); // 1秒→2秒
  }
  return response;
}

/**
 * シートのセルへ書き込む文字列を安全化する。
 * 先頭に ' を付けて必ずテキストとして保存させることで、
 *  (1) お客様メッセージ等に仕込まれた数式(=IMPORTXML 等)の評価を防ぎ(数式インジェクション対策)、
 *  (2) messageId・日付文字列の数値/Date自動変換による照合・比較の破壊を防ぐ。
 * (先頭の ' は入力プレフィックスとして扱われ、getValues() で読み戻す値には含まれない)
 */
function asCellText_(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return s === '' ? '' : "'" + s;
}

/** yyyy-MM-dd HH:mm:ss(JST) */
function formatDateTime_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

/** yyyy-MM-dd(JST) */
function formatDate_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

/** yyyyMM(JST。Dropboxの月別フォルダ用) */
function formatMonth_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyyMM');
}

/** yyyyMMdd_HHmmss(JST。Dropboxファイル名用) */
function formatTimestampCompact_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
}

/** タスク発生日ラベル(例: 7/2 LINE。§3.1 I列) */
function formatCreatedLabel_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'M/d') + ' LINE';
}

/** 本日からN日後の yyyy-MM-dd(期限間近判定は文字列の辞書順比較で行う) */
function formatDatePlusDays_(date, days) {
  return formatDate_(new Date(date.getTime() + days * 24 * 60 * 60 * 1000));
}

/**
 * エラーをエラーログシートに記録する(§4.6)。
 * ログ記録自体の失敗で本処理を殺さないよう、内部を握りつぶして console.error に残す。
 */
function logError_(context, error) {
  const message = (error && error.message) ? error.message : String(error);
  const stack = (error && error.stack) ? error.stack : '';
  console.error('[' + context + '] ' + message + (stack ? '\n' + stack : ''));
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEET.ERROR_LOG);
    if (sheet) {
      sheet.appendRow([formatDateTime_(new Date()), context, message, stack]);
    }
  } catch (e) {
    console.error('logError_ 自体が失敗: ' + e.message);
  }
}
