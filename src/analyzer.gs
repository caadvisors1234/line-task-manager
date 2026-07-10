/**
 * analyzer.gs — 分析バッチ本体(§4.3。5分おきの時間主導型トリガー対象)
 */

/** 分析バッチ(トリガー対象)。未分析メッセージをグループ単位でGemini分析しタスク起票する */
function runAnalysisBatch() {
  const startMs = Date.now();

  // 多重起動ガード: 前回バッチが5分を超えて実行中なら今回はスキップする
  // (ScriptLockで直列化するとdoPostのログ追記を数分ブロックするため、期限付きフラグで排他する)
  const props = PropertiesService.getScriptProperties();
  const lockedUntil = Number(props.getProperty(CONFIG.PROP.ANALYSIS_LOCK_UNTIL) || 0);
  if (startMs < lockedUntil) return;
  props.setProperty(CONFIG.PROP.ANALYSIS_LOCK_UNTIL,
    String(startMs + CONFIG.BATCH_TIME_LIMIT_MS + 60 * 1000));

  try {
    retryPendingTranscodes_(startMs);

    const pending = getUnanalyzedMessages_();
    if (pending.length === 0) return;

    const settings = getSettings_();

    // 同一グループの連続メッセージを1回の分析にまとめる(§4.3 手順1)
    const groupOrder = [];
    const byGroup = {};
    pending.forEach(function (message) {
      if (!byGroup[message.groupId]) {
        byGroup[message.groupId] = [];
        groupOrder.push(message.groupId);
      }
      byGroup[message.groupId].push(message);
    });

    for (let i = 0; i < groupOrder.length && i < settings.batchGroupLimit; i++) {
      // GASの6分制限ガード: 4.5分超過で残りを次回バッチへ持ち越す(§4.3 手順3)
      if (Date.now() - startMs > CONFIG.BATCH_TIME_LIMIT_MS) break;
      const groupId = groupOrder[i];
      try {
        analyzeGroup_(groupId, byGroup[groupId], settings);
      } catch (e) {
        logError_('analyzeGroup_(' + groupId + ')', e);
      }
    }
  } catch (e) {
    logError_('runAnalysisBatch', e);
  } finally {
    props.deleteProperty(CONFIG.PROP.ANALYSIS_LOCK_UNTIL);
  }
}

/** 1グループ分の未分析メッセージを分析して結果を適用する */
function analyzeGroup_(groupId, targetMessages, settings) {
  const salonName = targetMessages[0].salonName;
  const openTasks = getOpenTasksBySalon_(salonName);
  const openTaskIds = openTasks.map(function (t) { return t.taskId; });
  const context = buildAnalysisContext_(groupId, targetMessages, {
    salonName: salonName,
    openTasks: openTasks,
    settings: settings
  });

  let results;
  try {
    results = callAnalysis_(context, targetMessages);
  } catch (e) {
    if (e.geminiErrorType === 'parse') {
      // スキーマ不一致・パース不能は1回だけ再試行し、失敗なら「エラー」(§4.3 異常系)
      try {
        results = callAnalysis_(context, targetMessages);
      } catch (e2) {
        logError_('analyzeGroup_:parse(' + groupId + ')', e2);
        markAnalyzed_(targetMessages.map(function (m) { return m.rowIndex; }), STATUS.ANALYSIS.ERROR);
        return;
      }
    } else {
      // 429/5xx等: 未分析のまま残して次回再試行。試行回数が上限に達したら「エラー」+管理者通知
      logError_('analyzeGroup_:api(' + groupId + ')', e);
      handleApiFailure_(targetMessages);
      return;
    }
  }

  const resultByMessageId = {};
  results.forEach(function (r) { resultByMessageId[r.messageId] = r; });
  targetMessages.forEach(function (message) {
    applyAnalysisResult_(message, resultByMessageId[message.messageId], openTaskIds);
  });
}

/** Gemini呼び出し+応答の形式検証(全対象メッセージ分の判定が揃っているか) */
function callAnalysis_(context, targetMessages) {
  const results = callGemini_(ANALYSIS_SYSTEM_PROMPT, context, buildResponseSchema_());
  if (!Array.isArray(results)) {
    const error = new Error('Gemini応答が配列でない');
    error.geminiErrorType = 'parse';
    throw error;
  }
  const returnedIds = {};
  results.forEach(function (r) { returnedIds[r.messageId] = true; });
  const missing = targetMessages.filter(function (m) { return !returnedIds[m.messageId]; });
  if (missing.length > 0) {
    const error = new Error('Gemini応答に対象メッセージの判定が欠落: ' +
      missing.map(function (m) { return m.messageId; }).join(', '));
    error.geminiErrorType = 'parse';
    throw error;
  }
  return results;
}

/**
 * 分析文脈を組み立てる(§4.3 手順2a・§5.2)。
 * 直近会話ウィンドウ(自社発言を含む)+未完了タスク+返信テンプレート+一次受け定型文+現在日時。
 */
function buildAnalysisContext_(groupId, targetMessages, options) {
  const settings = options.settings;
  const targetIds = {};
  targetMessages.forEach(function (m) { targetIds[m.messageId] = true; });

  const conversation = getRecentConversation_(groupId, settings.conversationWindow);
  const inWindow = {};
  conversation.forEach(function (m) { inWindow[m.messageId] = true; });
  // 会話ウィンドウから漏れた分析対象(古い未分析)は先頭に補う
  const olderTargets = targetMessages.filter(function (m) { return !inWindow[m.messageId]; });

  const conversationLines = olderTargets.concat(conversation).map(function (m) {
    const marker = targetIds[m.messageId] ? '(分析対象 msg_id=' + m.messageId + ') ' : '';
    return '[' + m.speakerType + '] ' + marker + describeMessage_(m);
  });

  const taskLines = options.openTasks.length > 0
    ? options.openTasks.map(function (t) {
        return '- ' + t.taskId + ': ' + t.summary + '(タスク状況: ' + t.status + ')';
      })
    : ['(なし)'];

  const templates = getReplyTemplates_();
  const templateLines = templates.length > 0
    ? templates.map(function (t, i) {
        return (i + 1) + '. [' + t.name + '] 適用の目安: ' + t.guide + '\n' + t.body;
      })
    : ['(なし)'];

  return [
    '# 現在日時(JST)',
    Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm'),
    '',
    '# サロン名',
    options.salonName || '(未設定)',
    '',
    '# 未完了タスク一覧',
    taskLines.join('\n'),
    '',
    '# 一次受け定型文',
    settings.firstReplyTemplate || '(なし)',
    '',
    '# 返信テンプレート',
    templateLines.join('\n'),
    '',
    '# 直近の会話(古い順)',
    conversationLines.join('\n'),
    '',
    '# 分析対象メッセージID',
    targetMessages.map(function (m) { return m.messageId; }).join(', ')
  ].join('\n');
}

/** 会話1件をプロンプト用の文字列にする(非テキストはメタ情報で表現) */
function describeMessage_(message) {
  switch (message.msgType) {
    case 'text': return message.body;
    case 'image': return '(画像を受信)';
    case 'file': return '(ファイルを受信: ' + (message.body || '名称不明') + ')';
    case 'video': return '(動画を受信)';
    case 'audio': return '(音声を受信)';
    case 'sticker': return '(スタンプ)';
    default: return '(その他のメッセージ)';
  }
}

/** 判定結果を検証し、タスク起票とメッセージログ更新を行う(§4.3 手順2c〜2e) */
function applyAnalysisResult_(message, result, openTaskIds) {
  // relatedTaskIdの実在照合(AIの幻覚対策の二重防御。実在しない値は破棄し要確認に倒す)
  let relatedTaskId = result.relatedTaskId || '';
  let needsReview = !!result.needsReview;
  if (relatedTaskId && openTaskIds.indexOf(relatedTaskId) === -1) {
    relatedTaskId = '';
    needsReview = true;
  }

  let taskId = '';
  if (result.needsTask) {
    // 同一messageIdからの再起票を防ぐ(§4.3 異常系)
    taskId = findTaskBySourceMessageId_(message.messageId);
    if (!taskId) {
      const attachmentLink = message.dropboxLink.indexOf('http') === 0 ? message.dropboxLink : '';
      taskId = createTask_({
        dueText: result.dueDate || '',
        salonName: message.salonName,
        msgType: result.messageType,
        summary: result.summary,
        attachmentLink: attachmentLink,
        status: result.isApproval ? STATUS.TASK.AWAITING_APPLY : STATUS.TASK.TODO,
        createdLabel: createdLabelFromReceivedAt_(message.receivedAt),
        replyDraft: result.replyDraft || '',
        groupId: message.groupId,
        urgency: result.urgency || '',
        relatedTaskId: relatedTaskId,
        needsReview: needsReview,
        sourceMessageId: message.messageId,
        dueDate: result.dueDate || ''
      });
      // 既存タスクへの資料送付は、元タスクのG列(議事録・添付資料)にも追記する
      if (relatedTaskId && attachmentLink) {
        appendAttachmentLink_(relatedTaskId, attachmentLink);
      }
    }
  }
  setAnalysisResult_(message.rowIndex, STATUS.ANALYSIS.DONE, JSON.stringify(result), taskId);
}

/** 受信日時(yyyy-MM-dd HH:mm:ss)からタスク発生日ラベル(M/d LINE)を作る */
function createdLabelFromReceivedAt_(receivedAt) {
  const month = parseInt(receivedAt.substring(5, 7), 10);
  const day = parseInt(receivedAt.substring(8, 10), 10);
  return month + '/' + day + ' LINE';
}

/** API失敗時: 試行回数を加算し、上限到達で「エラー」+管理者通知(§4.3 異常系) */
function handleApiFailure_(targetMessages) {
  targetMessages.forEach(function (message) {
    const count = incrementRetryCount_(message.rowIndex);
    if (count >= CONFIG.MAX_ANALYSIS_RETRY) {
      markAnalyzed_([message.rowIndex], STATUS.ANALYSIS.ERROR);
      notifyAdmin_(
        '【エラー】メッセージの分析が' + CONFIG.MAX_ANALYSIS_RETRY + '回失敗しました' +
        '(messageId: ' + message.messageId + ')。メッセージログを確認してください。',
        'analysis_fail'
      );
    }
  });
}

/**
 * 動画・音声の変換待ち分を遅延再取得してDropboxへ保存する(§4.2 手順1)。
 * 受信時に変換未完了だったコンテンツを後続バッチで取得し直す。
 * 恒久失敗・期限超過は「未保存」を確定させて管理者に通知し、無期限リトライを防ぐ。
 */
function retryPendingTranscodes_(startMs) {
  const rows = getRowsByDropboxNote_(CONTENT_NOTE.TRANSCODING);
  if (rows.length === 0) return;
  // 受信日時(yyyy-MM-dd HH:mm:ss)は文字列の辞書順で新旧比較できる
  const cutoff = formatDateTime_(
    new Date(Date.now() - CONFIG.TRANSCODING_MAX_AGE_HOURS * 60 * 60 * 1000));

  rows.forEach(function (row) {
    if (Date.now() - startMs > CONFIG.BATCH_TIME_LIMIT_MS) return;
    try {
      const content = fetchMessageContent_(row.messageId, row.msgType);
      if (content.status === 'processing') {
        // まだ変換中。期限内なら次回バッチで再試行、超過なら打ち切り
        if (row.receivedAt < cutoff) giveUpTranscode_(row);
        return;
      }
      if (content.status !== 'ok') {
        giveUpTranscode_(row); // 変換の恒久失敗・コンテンツ失効
        return;
      }
      const extension = row.msgType === 'video' ? '.mp4' : '.m4a';
      // 受信日時文字列からパス部品を作る(Date再パースを避ける)
      const compact = row.receivedAt.replace(/[-:]/g, '').replace(' ', '_');
      const folder = row.salonName
        ? sanitizePathSegment_(row.salonName)
        : '_未設定/' + sanitizePathSegment_(row.groupId);
      const path = CONFIG.DROPBOX_ROOT_FOLDER + '/' + folder + '/' +
        row.receivedAt.substring(0, 7).replace('-', '') + '/' +
        compact + '_' + row.messageId + extension;
      uploadToDropbox_(content.blob, path);
      const link = getOrCreateSharedLink_(path);
      updateDropboxLink_(row.rowIndex, link);
      // 既に起票済みのタスクがあれば、G列(議事録・添付資料)へもリンクを追記する(§4.2 手順5)
      if (row.taskId) appendAttachmentLink_(row.taskId, link);
    } catch (e) {
      logError_('retryPendingTranscodes_(' + row.messageId + ')', e);
      if (String(e.message).indexOf('Dropbox認証エラー') !== -1) {
        // 受領データの取りこぼしに直結するため最重要アラート(§4.2)
        notifyAdmin_(
          '【最重要】Dropbox認証エラーが発生しています。受領ファイルが保存できません。' +
          'リフレッシュトークンの再取得(認可フロー)が必要です: ' + e.message,
          'dropbox_auth'
        );
      } else if (row.receivedAt < cutoff) {
        giveUpTranscode_(row); // 期限超過分は打ち切り(50MB超過等で失敗し続ける行の浪費防止)
      }
    }
  });
}

/** 変換待ちの再取得を打ち切り、未保存を確定させて管理者へ通知する */
function giveUpTranscode_(row) {
  updateDropboxLink_(row.rowIndex, CONTENT_NOTE.SKIPPED);
  notifyAdmin_(
    '【警告】動画・音声の保存を打ち切りました(messageId: ' + row.messageId +
    ')。必要な場合はLINEのトーク履歴から手動保存してください。',
    'content_skip'
  );
}
