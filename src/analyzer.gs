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

    // 関連メッセージ(依頼文とその画像等)が別バッチに分かれてタスクが割れるのを防ぐため、
    // 直近に発言があったグループは今回スキップして次回バッチにまとめる(§4.3 手順1)
    const ready = groupOrder.filter(function (groupId) {
      return isGroupReadyForAnalysis_(byGroup[groupId], startMs);
    });

    for (let i = 0; i < ready.length && i < settings.batchGroupLimit; i++) {
      // GASの6分制限ガード: 4.5分超過で残りを次回バッチへ持ち越す(§4.3 手順3)
      if (Date.now() - startMs > CONFIG.BATCH_TIME_LIMIT_MS) break;
      const groupId = ready[i];
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

/**
 * グループの分析を今回のバッチで実行してよいか判定する(§4.3 手順1)。
 * 「TOP画像を変えたい」→画像 のように用件が複数メッセージに分かれて届くため、
 * 最新メッセージから ANALYSIS_COOLDOWN_MS の間は後続を待って次回バッチへ持ち越す。
 * ただし発言が続くグループが滞留しないよう、最古の未分析が ANALYSIS_MAX_DEFER_MS を
 * 超えたら待たずに分析する。
 * 受信日時(yyyy-MM-dd HH:mm:ss)は文字列の辞書順で新旧比較できる(retryPendingTranscodes_と同様)。
 */
function isGroupReadyForAnalysis_(messages, nowMs) {
  let newest = '';
  let oldest = '';
  messages.forEach(function (message) {
    if (!newest || message.receivedAt > newest) newest = message.receivedAt;
    if (!oldest || message.receivedAt < oldest) oldest = message.receivedAt;
  });
  if (oldest < formatDateTime_(new Date(nowMs - CONFIG.ANALYSIS_MAX_DEFER_MS))) return true;
  return newest < formatDateTime_(new Date(nowMs - CONFIG.ANALYSIS_COOLDOWN_MS));
}

/** 1グループ分の未分析メッセージを分析して結果を適用する */
function analyzeGroup_(groupId, targetMessages, settings) {
  const salonName = targetMessages[0].salonName;
  const openTasks = getOpenTasksBySalon_(salonName);
  const openTaskIds = openTasks.map(function (t) { return t.taskId; });
  // 画像収集は1回だけ行い、parse再試行でも再ダウンロードしない(§4.3)
  const images = collectAnalysisImages_(targetMessages);
  const context = buildAnalysisContext_(groupId, targetMessages, {
    salonName: salonName,
    openTasks: openTasks,
    settings: settings,
    images: images
  });

  let results;
  try {
    results = callAnalysis_(context, targetMessages, images.parts);
  } catch (e) {
    if (e.geminiErrorType === 'parse') {
      // スキーマ不一致・パース不能は1回だけ再試行し、失敗なら「エラー」(§4.3 異常系)
      try {
        results = callAnalysis_(context, targetMessages, images.parts);
      } catch (e2) {
        logError_('analyzeGroup_:parse(' + groupId + ')', e2);
        markAnalyzed_(targetMessages.map(function (m) { return m.rowIndex; }), STATUS.ANALYSIS.ERROR);
        return;
      }
    } else if (e.httpStatus === 400 && images.parts.length > 0) {
      // 画像を含むリクエストの400は画像起因(破損・非対応形式等)の決定的エラーの可能性が高い。
      // 未分析のまま5回リトライ(約25分)を浪費しないよう、画像なしの文脈に組み直して1回だけ再実行する
      // (このフォールバックは最初の失敗が400の場合のみ。parse再試行の2回目の失敗は上の分岐で「エラー」)
      logError_('analyzeGroup_:image400(' + groupId + ')', e);
      const textOnlyContext = buildAnalysisContext_(groupId, targetMessages, {
        salonName: salonName,
        openTasks: openTasks,
        settings: settings,
        images: imagesAsFallback_(targetMessages)
      });
      try {
        results = callAnalysis_(textOnlyContext, targetMessages, []);
      } catch (e2) {
        logError_('analyzeGroup_:image400retry(' + groupId + ')', e2);
        if (e2.geminiErrorType === 'parse') {
          markAnalyzed_(targetMessages.map(function (m) { return m.rowIndex; }), STATUS.ANALYSIS.ERROR);
        } else {
          handleApiFailure_(targetMessages);
        }
        return;
      }
    } else {
      // 429/5xx等: 未分析のまま残して次回再試行。試行回数が上限に達したら「エラー」+管理者通知
      logError_('analyzeGroup_:api(' + groupId + ')', e);
      handleApiFailure_(targetMessages);
      return;
    }
  }

  // 応答1要素 = タスク1件。同一用件にまとめられた複数メッセージが1タスクになる(§4.3)
  results.forEach(function (result) {
    const members = memberMessages_(result, targetMessages);
    // 対象メッセージを1件も含まない要素(全IDが幻覚)は起票しない。
    // 対象の網羅はcallAnalysis_で検証済みのため、ここで未分析が取り残されることはない
    if (members.length > 0) applyTaskResult_(members, result, openTaskIds);
  });
}

/**
 * Gemini呼び出し+応答の形式検証。
 * 全対象メッセージが、いずれかのタスク要素の sourceMessageIds にちょうど1回ずつ
 * 現れることを確認する(欠落=取りこぼし、重複=同一メッセージからの二重起票)。
 * 対象外のID(会話文脈や幻覚)は起票側で無視するため、ここでは記録のみで失敗させない。
 */
function callAnalysis_(context, targetMessages, imageParts) {
  const results = callGemini_(ANALYSIS_SYSTEM_PROMPT, context, buildResponseSchema_(), imageParts);
  if (!Array.isArray(results)) {
    const error = new Error('Gemini応答が配列でない');
    error.geminiErrorType = 'parse';
    throw error;
  }

  // Object.create(null): 'constructor'等のIDを幻覚された際にObject.prototypeへ当たるのを防ぐ
  const targetIds = Object.create(null);
  targetMessages.forEach(function (m) { targetIds[m.messageId] = true; });
  const covered = Object.create(null);
  const duplicated = [];
  const unknown = [];
  results.forEach(function (result) {
    const ids = Array.isArray(result.sourceMessageIds) ? result.sourceMessageIds : [];
    const seenInResult = Object.create(null);
    ids.forEach(function (id) {
      if (!targetIds[id]) {
        unknown.push(id);
        return;
      }
      // 同一要素内の重複列挙はmemberMessages_が畳み込むため異常ではない。
      // 二重起票につながるのは要素をまたいだ重複のみ
      if (seenInResult[id]) return;
      seenInResult[id] = true;
      if (covered[id]) duplicated.push(id);
      covered[id] = true;
    });
  });
  if (unknown.length > 0) {
    logError_('callAnalysis_:unknownSourceIds', '対象外のsourceMessageIdsを無視: ' + unknown.join(', '));
  }
  const missing = targetMessages
    .filter(function (m) { return !covered[m.messageId]; })
    .map(function (m) { return m.messageId; });
  if (missing.length > 0 || duplicated.length > 0) {
    const error = new Error('Gemini応答のsourceMessageIdsが不正(欠落: [' + missing.join(', ') +
      '] / 重複: [' + duplicated.join(', ') + '])');
    error.geminiErrorType = 'parse';
    throw error;
  }
  return results;
}

/** タスク要素の sourceMessageIds に対応する対象メッセージを受信順で返す(§4.3) */
function memberMessages_(result, targetMessages) {
  const ids = Object.create(null); // callAnalysis_と同じく幻覚IDがObject.prototypeへ当たるのを防ぐ
  (result.sourceMessageIds || []).forEach(function (id) { ids[id] = true; });
  return targetMessages.filter(function (message) { return ids[message.messageId]; });
}

/**
 * 分析文脈を組み立てる(§4.3 手順2b・§5.2)。
 * 直近会話ウィンドウ(自社発言を含む)+未完了タスク+返信テンプレート+一次受け定型文+現在日時。
 * options.images(collectAnalysisImages_の戻り値)で、添付した画像の対応付けと
 * 未添付フォールバックの注記を会話行に付ける。
 */
function buildAnalysisContext_(groupId, targetMessages, options) {
  const settings = options.settings;
  const images = options.images || { attachedIndex: {}, fallback: {} };
  const targetIds = {};
  targetMessages.forEach(function (m) { targetIds[m.messageId] = true; });

  const conversation = getRecentConversation_(groupId, settings.conversationWindow);
  const inWindow = {};
  conversation.forEach(function (m) { inWindow[m.messageId] = true; });
  // 会話ウィンドウから漏れた分析対象(古い未分析)は先頭に補う
  const olderTargets = targetMessages.filter(function (m) { return !inWindow[m.messageId]; });

  const conversationLines = olderTargets.concat(conversation).map(function (m) {
    const marker = targetIds[m.messageId] ? '(分析対象 msg_id=' + m.messageId + ') ' : '';
    let imageNote = '';
    if (images.attachedIndex[m.messageId]) {
      imageNote = ' — 添付の画像' + images.attachedIndex[m.messageId];
    } else if (images.fallback[m.messageId]) {
      imageNote = ' — 画像本体は未添付';
    }
    return '[' + m.speakerType + '] ' + marker + describeMessage_(m) + imageNote;
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

/**
 * 分析対象メッセージの画像(imageと画像拡張子のfile)を収集し、Gemini用partsを組み立てる(§4.3)。
 * K列の共有リンクからダウンロードする(§4.2で保存済み。スコープ sharing.read)。
 * 取得失敗・サイズ超過・枚数超過は添付せずメタ情報のみへフォールバックし、
 * 例外を外へ投げない(画像が理由で分析リトライを消費させない)。
 * 戻り値: { parts: Gemini用parts配列, attachedIndex: {messageId: 1始まりの添付番号},
 *           fallback: {messageId: true}(画像だが未添付のもの) }
 */
function collectAnalysisImages_(targetMessages) {
  const parts = [];
  const attachedIndex = {};
  const fallback = {};
  let attachedCount = 0;

  targetMessages.forEach(function (message) {
    const mime = analysisImageMime_(message);
    if (!mime) return; // 画像でないメッセージは対象外
    // K列が共有リンクでない(未保存マーカー・空欄)行は添付できない(applyTaskResult_と同じ判定)
    if (message.dropboxLink.indexOf('http') !== 0) {
      fallback[message.messageId] = true;
      return;
    }
    if (attachedCount >= CONFIG.ANALYSIS_IMAGE_MAX_COUNT) {
      fallback[message.messageId] = true;
      return;
    }
    try {
      const bytes = downloadSharedLinkFile_(message.dropboxLink).getBytes();
      if (bytes.length === 0 || bytes.length > CONFIG.ANALYSIS_IMAGE_MAX_BYTES) {
        fallback[message.messageId] = true;
        return;
      }
      attachedCount++;
      attachedIndex[message.messageId] = attachedCount;
      parts.push({ text: '添付の画像' + attachedCount + ' (msg_id=' + message.messageId + ')' });
      parts.push({ inline_data: { mime_type: mime, data: Utilities.base64Encode(bytes) } });
    } catch (e) {
      logError_('collectAnalysisImages_(' + message.messageId + ')', e);
      if (String(e.message).indexOf('Dropbox認証エラー') !== -1) {
        notifyAdmin_(
          '【最重要】Dropbox認証エラーが発生しています。分析用の画像取得ができません。' +
          'リフレッシュトークンの再取得(認可フロー)が必要です: ' + e.message,
          'dropbox_auth'
        );
      }
      fallback[message.messageId] = true;
    }
  });

  return { parts: parts, attachedIndex: attachedIndex, fallback: fallback };
}

/**
 * メッセージが分析画像に該当すればMIMEタイプを、対象外ならnullを返す(§4.3)。
 * imageはjpg固定(contentExtension_と同じ前提)。fileは本文(=ファイル名)の拡張子で判定する。
 */
function analysisImageMime_(message) {
  if (message.msgType === 'image') return 'image/jpeg';
  if (message.msgType === 'file') {
    const match = String(message.body || '').match(/(\.[A-Za-z0-9]+)$/);
    if (match) return ANALYSIS_IMAGE_MIME[match[1].toLowerCase()] || null;
  }
  return null;
}

/** 全画像を未添付(フォールバック)扱いにした収集結果を返す(画像起因400の画像なし再実行用) */
function imagesAsFallback_(targetMessages) {
  const fallback = {};
  targetMessages.forEach(function (message) {
    if (analysisImageMime_(message)) fallback[message.messageId] = true;
  });
  return { parts: [], attachedIndex: {}, fallback: fallback };
}

/**
 * 判定結果1件(=タスク1件)を検証し、タスク起票とメッセージログ更新を行う(§4.3 手順2d〜2f)。
 * members: この判定にまとめられた対象メッセージ(受信順。先頭が最古)。
 */
function applyTaskResult_(members, result, openTaskIds) {
  // relatedTaskIdの実在照合(AIの幻覚対策の二重防御。実在しない値は破棄し要確認に倒す)
  let relatedTaskId = result.relatedTaskId || '';
  let needsReview = !!result.needsReview;
  if (relatedTaskId && openTaskIds.indexOf(relatedTaskId) === -1) {
    relatedTaskId = '';
    needsReview = true;
  }

  const messageIds = members.map(function (message) { return message.messageId; });
  let taskId = '';
  if (result.needsTask) {
    // 同一メッセージからの再起票を防ぐ(§4.3 異常系)
    taskId = findTaskBySourceMessageIds_(messageIds);
    if (!taskId) {
      // まとめた全メッセージの添付リンクをG列へ入れる(依頼文+画像が1タスクになるため)
      const links = members
        .map(function (message) { return message.dropboxLink; })
        .filter(function (link) { return link.indexOf('http') === 0; });
      const head = members[0];
      taskId = createTask_({
        dueText: result.dueDate || '',
        salonName: head.salonName,
        msgType: result.messageType,
        summary: result.summary,
        attachmentLink: links.join('\n'),
        status: result.isApproval ? STATUS.TASK.AWAITING_APPLY : STATUS.TASK.TODO,
        createdLabel: createdLabelFromReceivedAt_(head.receivedAt),
        replyDraft: result.replyDraft || '',
        groupId: head.groupId,
        urgency: result.urgency || '',
        relatedTaskId: relatedTaskId,
        needsReview: needsReview,
        sourceMessageId: messageIds.join(','),
        dueDate: result.dueDate || ''
      });
      // 既存タスクへの資料送付は、元タスクのG列(議事録・添付資料)にも追記する
      if (relatedTaskId && links.length > 0) {
        appendAttachmentLink_(relatedTaskId, links.join('\n'));
      }
    }
  }
  // まとめた各行に同じ判定JSON・タスクIDを記録する(どの行からの起票か追跡できるように)
  const resultJson = JSON.stringify(result);
  members.forEach(function (message) {
    setAnalysisResult_(message.rowIndex, STATUS.ANALYSIS.DONE, resultJson, taskId);
  });
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
