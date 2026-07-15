/**
 * main.gs — Webhookエントリポイント(§4.1)
 * doPostは例外を外へ投げず、いかなる分岐でも 'OK' を返す。
 * Webhook再送はOFF運用のため、失敗時の自動救済はない前提で各処理を即時リトライする。
 */

// メッセージログのK列に記録する保存状態マーカー(Dropboxリンク以外)
const CONTENT_NOTE = {
  TRANSCODING: '変換待ち',
  SKIPPED: 'サイズ超過または取得失敗のため未保存',
  AUTH_ERROR: '未保存(Dropbox認証エラー)'
};

function doPost(e) {
  try {
    // 1. 秘密トークン照合(不一致でも情報を与えず OK を返す。§6.1)
    const verifyToken = getProp_(CONFIG.PROP.VERIFY_TOKEN);
    if (!verifyToken || !e || !e.parameter || e.parameter.token !== verifyToken) {
      return okResponse_();
    }

    // 2. destination照合
    const body = JSON.parse(e.postData.contents);
    if (body.destination !== getProp_(CONFIG.PROP.BOT_USER_ID)) {
      return okResponse_();
    }

    (body.events || []).forEach(function (event) {
      try {
        handleEvent_(event);
      } catch (error) {
        logError_('handleEvent_(' + (event && event.type) + ')', error);
      }
    });
  } catch (error) {
    logError_('doPost', error);
  }
  return okResponse_();
}

function okResponse_() {
  return ContentService.createTextOutput('OK');
}

/** イベント種別の振り分けと重複排除(§4.1 手順3〜4) */
function handleEvent_(event) {
  const webhookEventId = event.webhookEventId || '';
  const messageId = (event.type === 'message' && event.message) ? event.message.id : null;
  if (isDuplicateEvent_(webhookEventId, messageId)) return;

  switch (event.type) {
    case 'message':
      handleMessageEvent_(event);
      break;
    case 'join':
      handleJoinEvent_(event);
      break;
    case 'leave':
      handleLeaveEvent_(event);
      break;
    default:
      return; // memberJoined等は無視(処理済みマークも不要)
  }
  markEventProcessed_(webhookEventId);
}

/** メッセージ受信(§4.1 手順4-message) */
function handleMessageEvent_(event) {
  if (!event.source || event.source.type !== 'group') return; // 1対1は対象外

  const groupId = event.source.groupId;

  // a. サロン名引き当て(未登録ならjoin漏れとして自動登録)
  let master = resolveSalonName_(groupId) || registerNewGroup_(groupId);
  if (master.state === STATUS.MASTER.INTERNAL) {
    // 社内グループの発言者は自社メンバーリストへ自動追記する(§3.4。失敗しても受信処理は壊さない)
    try {
      appendInternalUserId_(event.source.userId || '');
    } catch (error) {
      logError_('appendInternalUserId_', error);
    }
    return; // 社内グループはログ・分析の対象外(§3.3)
  }
  // サロン名が空欄のままの登録済みグループは、グループ名の取得を再試行して補記する(§3.3)
  if (!master.salonName) master = registerNewGroup_(groupId);

  // b. 発言者区分と表示名
  const userId = event.source.userId || '';
  const isInternal = userId && getInternalUserIds_().indexOf(userId) !== -1;
  let displayName = '(取得不可)';
  if (userId) {
    const profile = fetchGroupMemberProfile_(groupId, userId);
    if (profile && profile.displayName) displayName = profile.displayName;
  }

  const message = event.message;
  const knownTypes = ['text', 'image', 'file', 'video', 'audio', 'sticker'];
  const msgType = knownTypes.indexOf(message.type) !== -1 ? message.type : 'other';

  let bodyText = '';
  if (msgType === 'text') bodyText = message.text || '';
  if (msgType === 'file') bodyText = message.fileName || '';

  // c. メディアは同期でDropbox保存(コンテンツ失効前の確実な取得。§4.2)
  let dropboxLink = '';
  if (['image', 'file', 'video', 'audio'].indexOf(msgType) !== -1) {
    dropboxLink = saveContentToDropbox_(event, master.salonName, groupId);
  }

  // お客様発言のテキスト・メディアのみ分析対象(自社発言・スタンプ等は対象外。§3.2)
  const isAnalyzable = !isInternal &&
    ['text', 'image', 'file', 'video', 'audio'].indexOf(msgType) !== -1;

  const record = {
    receivedAt: formatDateTime_(new Date(event.timestamp)),
    groupId: groupId,
    salonName: master.salonName,
    speakerType: isInternal ? SPEAKER.INTERNAL : SPEAKER.CUSTOMER,
    userId: userId,
    displayName: displayName,
    msgType: msgType,
    body: bodyText,
    messageId: message.id,
    webhookEventId: event.webhookEventId || '',
    dropboxLink: dropboxLink,
    analysisStatus: isAnalyzable ? STATUS.ANALYSIS.PENDING : STATUS.ANALYSIS.SKIP
  };

  // d. ログ追記(ロック保護+最大3回再試行。失敗時は手動復旧のため管理者通知。§4.1)
  // 同一イベントの並行配信ですり抜けないよう、ロック内で重複を再チェックしてから追記する
  try {
    withRetry_(function () {
      withScriptLock_(function () {
        if (isDuplicateEvent_(record.webhookEventId, record.messageId)) return;
        appendMessageLog_(record);
      });
    });
  } catch (error) {
    logError_('appendMessageLog_', error);
    notifyAdmin_(
      '【エラー】メッセージログの記録に3回失敗しました(グループ: ' +
      (master.salonName || groupId) + ')。トーク履歴と突き合わせて手動復旧してください。',
      'log_append_fail'
    );
    throw error;
  }
}

/** Botがグループに追加された(§4.1 手順4-join) */
function handleJoinEvent_(event) {
  if (!event.source || event.source.type !== 'group') return;
  registerNewGroup_(event.source.groupId);
}

/** Botがグループから退出した(§4.1 手順4-leave) */
function handleLeaveEvent_(event) {
  if (!event.source || event.source.type !== 'group') return;
  updateGroupState_(event.source.groupId, STATUS.MASTER.LEFT);
}

/**
 * メディアコンテンツの即時取得→Dropbox保存(§4.2)。
 * 戻り値はK列に記録する文字列(共有リンク or 保存状態マーカー)。
 * 失敗しても例外を投げず、ログ追記(取りこぼし防止の本丸)は必ず続行させる。
 */
function saveContentToDropbox_(event, salonName, groupId) {
  const message = event.message;
  try {
    const content = fetchMessageContent_(message.id, message.type);
    if (content.status === 'processing') {
      // 動画・音声の変換未完了 → 分析バッチが遅延再取得する(§4.2 手順1)
      return CONTENT_NOTE.TRANSCODING;
    }
    if (content.status !== 'ok') {
      notifyAdmin_('【警告】コンテンツ取得に失敗しました(messageId: ' + message.id + ')', 'content_skip');
      return CONTENT_NOTE.SKIPPED;
    }
    const path = buildDropboxPath_(
      salonName, groupId, event.timestamp, message.id, contentExtension_(message));
    uploadToDropbox_(content.blob, path);
    return getOrCreateSharedLink_(path);
  } catch (error) {
    logError_('saveContentToDropbox_', error);
    if (String(error.message).indexOf('Dropbox認証エラー') !== -1) {
      // 受領データの取りこぼしに直結するため最重要アラート(§4.2)
      notifyAdmin_(
        '【最重要】Dropbox認証エラーが発生しています。受領ファイルが保存できません。' +
        'リフレッシュトークンの再取得(認可フロー)が必要です: ' + error.message,
        'dropbox_auth'
      );
      return CONTENT_NOTE.AUTH_ERROR;
    }
    // UrlFetchAppのサイズ上限(50MB)超過・ネットワークエラー等
    notifyAdmin_(
      '【警告】ファイル保存をスキップしました(messageId: ' + message.id + '): ' + error.message,
      'content_skip'
    );
    return CONTENT_NOTE.SKIPPED;
  }
}

/** メッセージタイプ・ファイル名から保存時の拡張子を決める */
function contentExtension_(message) {
  if (message.type === 'image') return '.jpg';
  if (message.type === 'video') return '.mp4';
  if (message.type === 'audio') return '.m4a';
  if (message.type === 'file' && message.fileName) {
    const match = String(message.fileName).match(/(\.[A-Za-z0-9]+)$/);
    if (match) return match[1].toLowerCase();
  }
  return '.bin';
}
