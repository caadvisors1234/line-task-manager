/**
 * lineClient.gs — LINE Messaging APIラッパ
 * コンテンツ取得のみ api-data.line.me(通常APIと別ドメイン。§4.2)。
 */

function lineHeaders_() {
  const token = getProp_(CONFIG.PROP.LINE_TOKEN);
  if (!token) throw new Error(CONFIG.PROP.LINE_TOKEN + ' が未設定です');
  return { Authorization: 'Bearer ' + token };
}

/** Pushメッセージ送信(通数はグループ人数分カウント。§4.4) */
function pushMessage_(to, messages) {
  // X-Line-Retry-Key: 5xxリトライ時の二重送信を防ぐ冪等キー
  const headers = Object.assign({ 'X-Line-Retry-Key': Utilities.getUuid() }, lineHeaders_());
  const response = fetchWithRetry_(CONFIG.LINE_API_BASE + '/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify({ to: to, messages: messages })
  });
  const code = response.getResponseCode();
  if (code >= 300) {
    throw new Error('LINE Push失敗(HTTP ' + code + '): ' + response.getContentText());
  }
}

/**
 * メッセージコンテンツ(画像・ファイル等)のBlobを取得する(§4.2 手順1)。
 * 動画・音声は変換完了を待つ(2秒間隔×最大3回)。
 * 戻り値: { status: 'ok', blob } / { status: 'processing' }(変換未完了・後で再取得可)
 *       / { status: 'failed' }(変換失敗・取得失敗などリトライしても回復しない)
 */
function fetchMessageContent_(messageId, msgType) {
  const base = CONFIG.LINE_DATA_API_BASE + '/v2/bot/message/' + messageId + '/content';

  if (msgType === 'video' || msgType === 'audio') {
    let ready = false;
    for (let i = 0; i < CONFIG.TRANSCODING_MAX_RETRY; i++) {
      const statusResponse = fetchWithRetry_(base + '/transcoding', { headers: lineHeaders_() }, 0);
      if (statusResponse.getResponseCode() === 200) {
        const status = JSON.parse(statusResponse.getContentText()).status;
        if (status === 'succeeded') { ready = true; break; }
        if (status === 'failed') return { status: 'failed' }; // 変換の恒久失敗(再取得不能)
      }
      Utilities.sleep(CONFIG.TRANSCODING_WAIT_MS);
    }
    // 変換未完了 → 呼び出し元が「変換待ち」を記録し、分析バッチで再取得
    if (!ready) return { status: 'processing' };
  }

  const response = fetchWithRetry_(base, { headers: lineHeaders_() });
  if (response.getResponseCode() !== 200) return { status: 'failed' };
  return { status: 'ok', blob: response.getBlob() };
}

/** グループメンバーの表示名を取得する。失敗時はnull(呼び出し元が「(取得不可)」で続行。§4.1) */
function fetchGroupMemberProfile_(groupId, userId) {
  try {
    const response = fetchWithRetry_(
      CONFIG.LINE_API_BASE + '/v2/bot/group/' + groupId + '/member/' + userId,
      { headers: lineHeaders_() }, 1
    );
    if (response.getResponseCode() !== 200) return null;
    return JSON.parse(response.getContentText());
  } catch (e) {
    return null;
  }
}

/** 当月の通数消費を取得する(§4.4 手順1)。失敗時はnull */
function fetchQuotaConsumption_() {
  try {
    const response = fetchWithRetry_(
      CONFIG.LINE_API_BASE + '/v2/bot/message/quota/consumption',
      { headers: lineHeaders_() }, 1
    );
    if (response.getResponseCode() !== 200) return null;
    const usage = Number(JSON.parse(response.getContentText()).totalUsage);
    return Number.isFinite(usage) ? usage : null; // フィールド欠落時にNaNを返さない
  } catch (e) {
    return null;
  }
}
