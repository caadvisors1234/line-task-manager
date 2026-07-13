/**
 * dropboxClient.gs — Dropbox APIラッパ(OAuth2リフレッシュトークンフロー。§4.2・§6.2)
 */

const DROPBOX_TOKEN_CACHE_KEY = 'dropbox:access_token';

/**
 * 初回セットアップ時のみGASエディタから手動実行する(§6.2 手順3)。
 * ブラウザ認可で得た認可コードを渡すと、リフレッシュトークンを取得して
 * スクリプトプロパティ DROPBOX_REFRESH_TOKEN へ保存する。
 */
function exchangeDropboxAuthCode(authCode) {
  if (!authCode) throw new Error('認可コードを引数に渡してください: exchangeDropboxAuthCode("<コード>")');
  const response = UrlFetchApp.fetch(CONFIG.DROPBOX_API_BASE + '/oauth2/token', {
    method: 'post',
    payload: {
      code: authCode,
      grant_type: 'authorization_code',
      client_id: getProp_(CONFIG.PROP.DROPBOX_APP_KEY),
      client_secret: getProp_(CONFIG.PROP.DROPBOX_APP_SECRET)
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('認可コードの交換に失敗: ' + response.getContentText());
  }
  const body = JSON.parse(response.getContentText());
  if (!body.refresh_token) {
    throw new Error('refresh_tokenが返されませんでした。認可URLに token_access_type=offline が付いているか確認してください');
  }
  PropertiesService.getScriptProperties().setProperty(CONFIG.PROP.DROPBOX_REFRESH_TOKEN, body.refresh_token);
  console.log('リフレッシュトークンを保存しました(' + CONFIG.PROP.DROPBOX_REFRESH_TOKEN + ')');
}

/**
 * 認可コードをスクリプトプロパティ DROPBOX_AUTH_CODE 経由で渡してリフレッシュトークンを取得する
 * (GASエディタは引数付き関数を直接実行できないため。セットアップ時のみ手動実行)。
 * 手順: スクリプトプロパティ DROPBOX_AUTH_CODE に認可コードを登録 → 本関数を実行。
 * 成功すると認可コードは使い捨てのため一時プロパティを削除する。
 */
function exchangeDropboxAuthCodeFromProp() {
  const props = PropertiesService.getScriptProperties();
  const code = props.getProperty('DROPBOX_AUTH_CODE');
  if (!code) throw new Error('先にスクリプトプロパティ DROPBOX_AUTH_CODE に認可コードを登録してください');
  exchangeDropboxAuthCode(code);
  props.deleteProperty('DROPBOX_AUTH_CODE');
  console.log('一時プロパティ DROPBOX_AUTH_CODE を削除しました');
}

/**
 * 短命アクセストークンを取得する(§6.2 手順4)。
 * リフレッシュトークンから再発行し、expires_inの90%の期間キャッシュする。
 * 認証エラーは「Dropbox認証エラー」を含むメッセージで投げる(最重要アラートの判定に使用。§4.2)。
 */
function getDropboxAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(DROPBOX_TOKEN_CACHE_KEY);
  if (cached) return cached;

  const refreshToken = getProp_(CONFIG.PROP.DROPBOX_REFRESH_TOKEN);
  if (!refreshToken) throw new Error('Dropbox認証エラー: ' + CONFIG.PROP.DROPBOX_REFRESH_TOKEN + ' が未設定です');

  const response = fetchWithRetry_(CONFIG.DROPBOX_API_BASE + '/oauth2/token', {
    method: 'post',
    payload: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: getProp_(CONFIG.PROP.DROPBOX_APP_KEY),
      client_secret: getProp_(CONFIG.PROP.DROPBOX_APP_SECRET)
    }
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Dropbox認証エラー: アクセストークン再発行に失敗(HTTP ' +
      response.getResponseCode() + '): ' + response.getContentText());
  }
  const body = JSON.parse(response.getContentText());
  const ttl = Math.min(Math.floor(Number(body.expires_in || 14400) * 0.9), 21600);
  cache.put(DROPBOX_TOKEN_CACHE_KEY, body.access_token, ttl);
  return body.access_token;
}

/** ファイルをアップロードする(同一パスはoverwriteで冪等。§4.2 手順3) */
function uploadToDropbox_(blob, path) {
  const response = fetchWithRetry_(CONFIG.DROPBOX_CONTENT_API_BASE + '/2/files/upload', {
    method: 'post',
    contentType: 'application/octet-stream',
    headers: {
      Authorization: 'Bearer ' + getDropboxAccessToken_(),
      'Dropbox-API-Arg': headerSafeJson_({ path: path, mode: 'overwrite', autorename: false, mute: true })
    },
    payload: blob.getBytes()
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Dropboxアップロード失敗(HTTP ' + response.getResponseCode() + '): ' +
      response.getContentText());
  }
  return JSON.parse(response.getContentText());
}

/**
 * 共有リンクを取得する(§4.2 手順4)。
 * 既存リンクありの409(shared_link_already_exists)はエラーレスポンス内の
 * メタデータまたは list_shared_links で既存リンクを返す。
 */
function getOrCreateSharedLink_(path) {
  const token = getDropboxAccessToken_();
  const response = fetchWithRetry_(
    CONFIG.DROPBOX_API_BASE + '/2/sharing/create_shared_link_with_settings', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ path: path })
    });
  const code = response.getResponseCode();
  if (code === 200) {
    return JSON.parse(response.getContentText()).url;
  }
  if (code === 409) {
    // エラーレスポンスに既存リンクのメタデータが含まれる場合はそれを使う
    try {
      const error = JSON.parse(response.getContentText());
      const meta = error.error && error.error.shared_link_already_exists &&
        error.error.shared_link_already_exists.metadata;
      if (meta && meta.url) return meta.url;
    } catch (e) { /* fall through */ }

    const listResponse = fetchWithRetry_(CONFIG.DROPBOX_API_BASE + '/2/sharing/list_shared_links', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ path: path, direct_only: true })
    });
    if (listResponse.getResponseCode() === 200) {
      const links = JSON.parse(listResponse.getContentText()).links;
      if (links && links.length > 0) return links[0].url;
    }
  }
  throw new Error('Dropbox共有リンク取得失敗(HTTP ' + code + '): ' + response.getContentText());
}

/**
 * Dropbox-API-Argヘッダー用のHTTP header safe JSON(§4.2 手順3)。
 * 非ASCII文字(日本語サロン名等)を \uXXXX にエスケープする。
 */
function headerSafeJson_(obj) {
  return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, function (c) {
    return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

/**
 * 保存パスを組み立てる(§4.2 手順3)。
 * /LINEタスク管理/{サロン名}/{yyyyMM}/{yyyyMMdd_HHmmss}_{messageId}.{拡張子}
 * サロン名未設定時は /LINEタスク管理/_未設定/{groupId}/... に保存。
 * 日時はWebhookイベントのtimestamp(重複配信でも不変)から生成し、パスを冪等にする。
 */
function buildDropboxPath_(salonName, groupId, eventTimestamp, messageId, extension) {
  const date = new Date(eventTimestamp);
  const folder = salonName
    ? sanitizePathSegment_(salonName)
    : '_未設定/' + sanitizePathSegment_(groupId);
  return CONFIG.DROPBOX_ROOT_FOLDER + '/' + folder + '/' + formatMonth_(date) + '/' +
    formatTimestampCompact_(date) + '_' + messageId + (extension || '');
}

/** パス不可文字を _ に置換する(§4.2 手順3) */
function sanitizePathSegment_(segment) {
  return String(segment).replace(/[\\/:?*"<>|]/g, '_').trim();
}
