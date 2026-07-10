/**
 * test.gs — 手動テスト用(§9.1)
 * GASエディタから各 test_* 関数を実行し、ログ(console)とシートで結果を確認する。
 * 開発用スプレッドシート(SPREADSHEET_ID)に対して実行すること。本番シートでは実行しない。
 */

// テスト用の擬似ID(実在しないLINE ID。顧客マスタにはテスト実行時に自動登録される)
const TEST_GROUP_PREFIX = 'Ctest';
const TEST_CUSTOMER_USER_ID = 'Utestcustomer00000000000000000001';
const TEST_INTERNAL_USER_ID = 'Utestinternal00000000000000000001';

/** テスト用グループを顧客マスタへ登録し、サロン名を記入する */
function ensureTestGroup_(groupSuffix, salonName) {
  const groupId = TEST_GROUP_PREFIX + groupSuffix;
  const entry = registerNewGroup_(groupId);
  if (!entry.salonName) {
    getSpreadsheet_().getSheetByName(SHEET.MASTER)
      .getRange(entry.rowIndex, COL.MASTER.SALON).setValue(salonName);
  }
  return groupId;
}

/** 擬似Webhookイベント(テキスト) */
function makeTextEvent_(groupId, userId, text) {
  const id = Utilities.getUuid().replace(/-/g, '');
  return {
    type: 'message',
    webhookEventId: 'testevt' + id,
    timestamp: Date.now(),
    source: { type: 'group', groupId: groupId, userId: userId },
    message: { id: 'testmsg' + id, type: 'text', text: text }
  };
}

/** 擬似Webhookイベント(画像) */
function makeImageEvent_(groupId, userId) {
  const id = Utilities.getUuid().replace(/-/g, '');
  return {
    type: 'message',
    webhookEventId: 'testevt' + id,
    timestamp: Date.now(),
    source: { type: 'group', groupId: groupId, userId: userId },
    message: { id: 'testmsg' + id, type: 'image', contentProvider: { type: 'line' } }
  };
}

/** 本物のdoPost引数と同じ形の e を組み立てて doPost を直接呼ぶ */
function callDoPost_(events) {
  const e = {
    parameter: { token: getProp_(CONFIG.PROP.VERIFY_TOKEN) },
    postData: {
      contents: JSON.stringify({
        destination: getProp_(CONFIG.PROP.BOT_USER_ID),
        events: events
      })
    }
  };
  return doPost(e);
}

function logRowCount_() {
  return getSpreadsheet_().getSheetByName(SHEET.LOG).getLastRow();
}

/** messageIdでメッセージログ行を探す(検証用) */
function findLogRow_(messageId) {
  const tail = getLogTail_();
  for (let i = 0; i < tail.values.length; i++) {
    if (String(tail.values[i][COL.LOG.MESSAGE_ID - 1]) === messageId) {
      return { rowIndex: tail.startRow + i, values: tail.values[i] };
    }
  }
  return null;
}

/** タスクIDでタスク行を探す(検証用) */
function findTaskRow_(taskId) {
  const rows = getTaskRows_();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][COL.TASK.TASK_ID - 1]) === taskId) return rows[i];
  }
  return null;
}

function assert_(label, condition, detail) {
  console.log((condition ? '[PASS] ' : '[FAIL] ') + label + (detail ? ' — ' + detail : ''));
  return condition;
}

// ---------------------------------------------------------------------------
// P3: リポジトリ層
// ---------------------------------------------------------------------------

/** タスク採番・列保護・G列追記の基本動作を確認する */
function test_taskRepoBasics() {
  const groupId = ensureTestGroup_('repo0000000000000000000000001', 'テストサロン様');

  const id1 = createTask_({
    salonName: 'テストサロン様', msgType: MSG_TYPE.NEW, summary: 'リポジトリテスト用タスク1',
    status: STATUS.TASK.TODO, createdLabel: '7/10 LINE', groupId: groupId,
    sourceMessageId: 'testsrc-' + Utilities.getUuid()
  });
  const id2 = createTask_({
    salonName: 'テストサロン様', msgType: MSG_TYPE.QUESTION, summary: 'リポジトリテスト用タスク2',
    status: STATUS.TASK.TODO, createdLabel: '7/10 LINE', groupId: groupId,
    sourceMessageId: 'testsrc-' + Utilities.getUuid()
  });

  const n1 = parseInt(id1.replace('T-', ''), 10);
  const n2 = parseInt(id2.replace('T-', ''), 10);
  assert_('タスクIDが連番で採番される', n2 === n1 + 1, id1 + ' → ' + id2);

  const row1 = findTaskRow_(id1);
  assert_('B列(納品データ)・C列(担当者名)が空で作成される',
    row1[COL.TASK.DELIVERY - 1] === '' && row1[COL.TASK.ASSIGNEE - 1] === '');

  appendAttachmentLink_(id1, 'https://example.com/link1');
  appendAttachmentLink_(id1, 'https://example.com/link2');
  const g = String(findTaskRow_(id1)[COL.TASK.ATTACHMENT - 1]);
  assert_('G列への追記が既存内容を消さない(改行追加)',
    g === 'https://example.com/link1\nhttps://example.com/link2', JSON.stringify(g));

  const open = getOpenTasksBySalon_('テストサロン様');
  assert_('未完了タスクの取得に作成分が含まれる',
    open.some(function (t) { return t.taskId === id1; }));
}

// ---------------------------------------------------------------------------
// P4: サマリ生成
// ---------------------------------------------------------------------------

/** フィクスチャのタスク群からサマリ文を組み立てて出力する(§4.4のフォーマット確認) */
function test_buildSummary() {
  const now = new Date();
  const today = formatDate_(now);
  const tasks = [
    { taskId: 'T-9001', dueText: '本日17:00', salonName: 'サロンB様', summary: 'キャンペーン用バナーの当日修正', status: STATUS.TASK.URGENT, needsReview: false, dueDate: today },
    { taskId: 'T-9002', dueText: '6/30〜7/1', salonName: '銀座整体院様', summary: '開始日変更の反映', status: STATUS.TASK.AWAITING_APPLY, needsReview: false, dueDate: formatDatePlusDays_(now, 1) },
    { taskId: 'T-9003', dueText: '毎月希望', salonName: 'アース大槻様', summary: 'インスタ投稿用画像の依頼', status: STATUS.TASK.TODO, needsReview: false, dueDate: '' },
    { taskId: 'T-9004', dueText: '', salonName: 'サロンC様', summary: '掲載文の修正依頼', status: STATUS.TASK.REQUESTED, needsReview: true, dueDate: '' },
    { taskId: 'T-9005', dueText: '', salonName: 'ガーデンウシワカマル様', summary: '看板画像の確認', status: STATUS.TASK.TODO, needsReview: false, dueDate: '' },
    { taskId: 'T-9006', dueText: '', salonName: 'サロンD様', summary: 'ロゴ差し替え', status: STATUS.TASK.AWAITING_CUSTOMER, needsReview: false, dueDate: '' },
    { taskId: 'T-9007', dueText: '', salonName: 'サロンE様', summary: 'クーポン修正', status: STATUS.TASK.AWAITING_CUSTOMER, needsReview: false, dueDate: '' },
    // 完了済み・対象外は getTasksForSummary_ 側で除外される想定のため含めない
  ];
  const text = buildSummaryText_(tasks, {
    now: now,
    dueSoonDays: 3,
    maxItems: 15,
    errorCount: 1,
    unnamedGroupCount: 1,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/xxxx'
  });
  console.log(text);
  assert_('急ぎ・期限間近が2件', text.indexOf('── 急ぎ・期限間近 2件 ──') !== -1);
  assert_('[急ぎ]ラベル付き', text.indexOf('[急ぎ] サロンB様|キャンペーン用バナーの当日修正(本日17:00)') !== -1);
  assert_('未対応・依頼中が3件', text.indexOf('── 未対応・依頼中 3件 ──') !== -1);
  assert_('※要確認の付記', text.indexOf('サロンC様|掲載文の修正依頼 ※要確認') !== -1);
  assert_('件数のみ区分', text.indexOf('── お客様連絡待ち 2件|反映待ち 1件 ──') !== -1);
  assert_('分析失敗の表示', text.indexOf('分析失敗1件') !== -1);

  // 切り詰め(5,000文字対策)の確認
  const truncated = buildSummaryText_(tasks, {
    now: now, dueSoonDays: 3, maxItems: 2, errorCount: 0, unnamedGroupCount: 0, sheetUrl: 'https://example.com'
  });
  assert_('最大表示件数での切り詰め', truncated.indexOf('ほか1件はシート参照') !== -1);
}

// ---------------------------------------------------------------------------
// P5: Webhook受信系(LINE不要。プロフィール取得は失敗→「(取得不可)」で続行)
// ---------------------------------------------------------------------------

/** テキストメッセージの受信→ログ追記を確認する */
function test_simulateTextMessage() {
  const groupId = ensureTestGroup_('text0000000000000000000000001', 'テストサロン様');
  const event = makeTextEvent_(groupId, TEST_CUSTOMER_USER_ID, 'テスト送信: クーポン画像を金曜までに差し替えてください');
  callDoPost_([event]);

  const row = findLogRow_(event.message.id);
  assert_('メッセージログに1行追加される', row !== null);
  if (row) {
    assert_('発言者区分がお客様', row.values[COL.LOG.SPEAKER_TYPE - 1] === SPEAKER.CUSTOMER);
    assert_('分析ステータスが未分析', row.values[COL.LOG.ANALYSIS_STATUS - 1] === STATUS.ANALYSIS.PENDING);
  }
}

/** 自社メンバー発言の判定を確認する(設定シートに TEST_INTERNAL_USER_ID を登録して実行) */
function test_simulateInternalMessage() {
  const internalIds = getInternalUserIds_();
  if (internalIds.indexOf(TEST_INTERNAL_USER_ID) === -1) {
    console.log('[SKIP] 設定シートの「自社メンバーuserIDリスト」に ' + TEST_INTERNAL_USER_ID + ' を追加してから実行してください');
    return;
  }
  const groupId = ensureTestGroup_('text0000000000000000000000001', 'テストサロン様');
  const event = makeTextEvent_(groupId, TEST_INTERNAL_USER_ID, '掲載文を修正し、下書き登録いたしました。');
  callDoPost_([event]);

  const row = findLogRow_(event.message.id);
  assert_('発言者区分が自社', row && row.values[COL.LOG.SPEAKER_TYPE - 1] === SPEAKER.INTERNAL);
  assert_('自社発言は分析対象外', row && row.values[COL.LOG.ANALYSIS_STATUS - 1] === STATUS.ANALYSIS.SKIP);
}

/** 重複イベントの排除(S8のフィクスチャ版): 同一イベント2回投入で1行のみ */
function test_simulateDuplicateEvent() {
  const groupId = ensureTestGroup_('dup00000000000000000000000001', 'テストサロン様');
  const event = makeTextEvent_(groupId, TEST_CUSTOMER_USER_ID, '重複テストメッセージ');
  callDoPost_([event]);
  const countAfterFirst = logRowCount_();
  callDoPost_([event]); // 同一webhookEventId・同一messageIdを再投入
  const countAfterSecond = logRowCount_();
  assert_('重複イベントが二重登録されない', countAfterSecond === countAfterFirst,
    '1回目後: ' + countAfterFirst + '行 / 2回目後: ' + countAfterSecond + '行');
}

/** 不正リクエストの排除: token不一致・destination不一致で何も書かれない */
function test_rejectInvalidRequest() {
  const before = logRowCount_();
  const groupId = ensureTestGroup_('text0000000000000000000000001', 'テストサロン様');
  const event = makeTextEvent_(groupId, TEST_CUSTOMER_USER_ID, '不正リクエストテスト');

  // token不一致
  doPost({
    parameter: { token: 'wrong-token' },
    postData: { contents: JSON.stringify({ destination: getProp_(CONFIG.PROP.BOT_USER_ID), events: [event] }) }
  });
  // destination不一致
  doPost({
    parameter: { token: getProp_(CONFIG.PROP.VERIFY_TOKEN) },
    postData: { contents: JSON.stringify({ destination: 'Uattacker', events: [event] }) }
  });
  assert_('token/destination不一致のイベントが破棄される', logRowCount_() === before);
}

/** joinイベント→顧客マスタ自動追加、社内グループのスキップを確認する */
function test_simulateJoinAndInternalGroup() {
  const suffix = Utilities.getUuid().replace(/-/g, '').substring(0, 24);
  const groupId = TEST_GROUP_PREFIX + 'join' + suffix;
  callDoPost_([{
    type: 'join',
    webhookEventId: 'testevtjoin' + suffix,
    timestamp: Date.now(),
    source: { type: 'group', groupId: groupId }
  }]);
  const entry = resolveSalonName_(groupId);
  assert_('joinイベントで顧客マスタに自動追加される', entry !== null && entry.state === STATUS.MASTER.ACTIVE);

  // 状態を「社内」にするとメッセージがログに残らない(§3.3)
  if (entry) {
    getSpreadsheet_().getSheetByName(SHEET.MASTER)
      .getRange(entry.rowIndex, COL.MASTER.STATE).setValue(STATUS.MASTER.INTERNAL);
    const before = logRowCount_();
    callDoPost_([makeTextEvent_(groupId, TEST_CUSTOMER_USER_ID, '社内グループのテスト発言')]);
    assert_('社内グループの発言はログ・分析の対象外', logRowCount_() === before);
  }
}

/**
 * 画像メッセージの受信(S5相当)。
 * 注意: LINEチャネル・Dropboxアプリの結線後に実行すること。未結線の場合は
 * コンテンツ取得に失敗し、K列に「サイズ超過または取得失敗のため未保存」が入る(それ自体は正常系)。
 */
function test_simulateImageMessage() {
  const groupId = ensureTestGroup_('img00000000000000000000000001', 'テストサロン様');
  const event = makeImageEvent_(groupId, TEST_CUSTOMER_USER_ID);
  callDoPost_([event]);
  const row = findLogRow_(event.message.id);
  assert_('メッセージログに1行追加される', row !== null);
  if (row) {
    console.log('K列(Dropboxリンク): ' + row.values[COL.LOG.DROPBOX_LINK - 1]);
    console.log('※擬似messageIdのためLINE実結線後もコンテンツ取得は404になる。実画像はテストグループから送信して確認する');
  }
}

// ---------------------------------------------------------------------------
// P6: 分析バッチ(Gemini実API。GEMINI_API_KEYが必要。LINE・Dropbox不要)
// ---------------------------------------------------------------------------

/** フィクスチャ会話をログへ直接投入する(doPost・LINEを経由しない) */
function insertFixtureLog_(groupId, salonName, speakerType, text) {
  const messageId = 'testmsg' + Utilities.getUuid().replace(/-/g, '');
  withScriptLock_(function () {
    appendMessageLog_({
      receivedAt: formatDateTime_(new Date()),
      groupId: groupId,
      salonName: salonName,
      speakerType: speakerType,
      userId: speakerType === SPEAKER.INTERNAL ? TEST_INTERNAL_USER_ID : TEST_CUSTOMER_USER_ID,
      displayName: speakerType === SPEAKER.INTERNAL ? 'テスト自社' : 'テスト顧客',
      msgType: 'text',
      body: text,
      messageId: messageId,
      webhookEventId: 'testevt' + Utilities.getUuid().replace(/-/g, ''),
      dropboxLink: '',
      analysisStatus: speakerType === SPEAKER.INTERNAL ? STATUS.ANALYSIS.SKIP : STATUS.ANALYSIS.PENDING
    });
  });
  return messageId;
}

/**
 * 残っている未分析行をすべて「分析対象外」にする(テストの前処理)。
 * 過去テストの残骸がバッチの処理グループ数上限(初期値5)を消費すると、
 * フィクスチャ5グループの一部が次回バッチへ持ち越されて検証が狂うため。
 */
function clearPendingAnalysisRows_() {
  const tail = getLogTail_();
  const rowIndexes = [];
  for (let i = 0; i < tail.values.length; i++) {
    if (String(tail.values[i][COL.LOG.ANALYSIS_STATUS - 1]) === STATUS.ANALYSIS.PENDING) {
      rowIndexes.push(tail.startRow + i);
    }
  }
  if (rowIndexes.length > 0) markAnalyzed_(rowIndexes, STATUS.ANALYSIS.SKIP);
  return rowIndexes.length;
}

/**
 * 結合テストシナリオS1〜S4・S6のフィクスチャ版(§9.2)。
 * 5つのテストグループへ会話を投入し、分析バッチを実行して結果を検証する。
 * 実行前提: GEMINI_API_KEY 設定済み・setupSpreadsheet() 実行済み。
 */
function test_runAnalysisOnFixture() {
  const cleared = clearPendingAnalysisRows_();
  if (cleared > 0) console.log('前処理: 過去テストの未分析 ' + cleared + ' 行を分析対象外にしました');

  // S1: 新規依頼(期限あり)
  const g1 = ensureTestGroup_('fixs1000000000000000000000001', 'テストサロンS1様');
  const s1 = insertFixtureLog_(g1, 'テストサロンS1様', SPEAKER.CUSTOMER,
    'クーポン画像を金曜までに差し替えてください');

  // S2: 進行承認(自社のアクション予告→お客様の承認)
  const g2 = ensureTestGroup_('fixs2000000000000000000000001', 'テストサロンS2様');
  insertFixtureLog_(g2, 'テストサロンS2様', SPEAKER.INTERNAL,
    '掲載文を修正し、下書き登録いたしました。ご確認のうえ、問題なければ反映いたします。');
  const s2 = insertFixtureLog_(g2, 'テストサロンS2様', SPEAKER.CUSTOMER, 'ありがとうございます!');

  // S3: 単なるお礼・雑談(アクション予告なし)
  const g3 = ensureTestGroup_('fixs3000000000000000000000001', 'テストサロンS3様');
  const s3 = insertFixtureLog_(g3, 'テストサロンS3様', SPEAKER.CUSTOMER,
    '先日はご対応ありがとうございました。今後ともよろしくお願いします。');

  // S4: 既存未完了タスクへの回答
  const g4 = ensureTestGroup_('fixs4000000000000000000000001', 'テストサロンS4様');
  const existingTaskId = createTask_({
    salonName: 'テストサロンS4様', msgType: MSG_TYPE.NEW,
    summary: 'ホットペッパー広告バナーの差し替え', status: STATUS.TASK.REQUESTED,
    createdLabel: '7/9 LINE', groupId: g4, sourceMessageId: 'testsrc-' + Utilities.getUuid()
  });
  insertFixtureLog_(g4, 'テストサロンS4様', SPEAKER.INTERNAL,
    '広告バナーの差し替え案を2パターンお送りしました。どちらがよいかご確認ください。');
  const s4 = insertFixtureLog_(g4, 'テストサロンS4様', SPEAKER.CUSTOMER,
    'バナーの件、Aパターンでお願いします!');

  // S6: 判断に迷う新規依頼(一次受け定型文の下書きを期待)
  const g6 = ensureTestGroup_('fixs6000000000000000000000001', 'テストサロンS6様');
  const s6 = insertFixtureLog_(g6, 'テストサロンS6様', SPEAKER.CUSTOMER,
    '来月から料金体系を大きく変えようと思っているのですが、掲載全体をどう直すのがよいでしょうか。相談させてください。');

  runAnalysisBatch();

  verifyFixtureResult_('S1', s1, function (row, task) {
    assert_('S1: 起票される', task !== null);
    if (!task) return;
    assert_('S1: 種別=新規依頼', task[COL.TASK.MSG_TYPE - 1] === MSG_TYPE.NEW,
      String(task[COL.TASK.MSG_TYPE - 1]));
    assert_('S1: タスク状況=未対応', task[COL.TASK.STATUS - 1] === STATUS.TASK.TODO);
    console.log('S1: 期限(R列)=' + task[COL.TASK.DUE_DATE - 1] + '(直近の金曜日付になっているか目視確認)');
  });
  verifyFixtureResult_('S2', s2, function (row, task) {
    assert_('S2: 起票される', task !== null);
    if (!task) return;
    assert_('S2: 種別=回答・承認', task[COL.TASK.MSG_TYPE - 1] === MSG_TYPE.APPROVAL,
      String(task[COL.TASK.MSG_TYPE - 1]));
    assert_('S2: タスク状況=反映待ち', task[COL.TASK.STATUS - 1] === STATUS.TASK.AWAITING_APPLY,
      String(task[COL.TASK.STATUS - 1]));
  });
  verifyFixtureResult_('S3', s3, function (row, task) {
    assert_('S3: 起票されない(雑談・お礼)', task === null,
      row ? 'L列=' + row.values[COL.LOG.ANALYSIS_STATUS - 1] + ' / M列=' + row.values[COL.LOG.ANALYSIS_JSON - 1] : '');
  });
  verifyFixtureResult_('S4', s4, function (row, task) {
    assert_('S4: 起票される', task !== null);
    if (!task) return;
    const related = String(task[COL.TASK.RELATED_TASK_ID - 1]);
    const needsReview = String(task[COL.TASK.NEEDS_REVIEW - 1]) !== '';
    assert_('S4: 関連タスクIDが正しい(または要確認に倒れる)',
      related === existingTaskId || needsReview,
      '関連=' + related + ' / 期待=' + existingTaskId + ' / 要確認=' + needsReview);
  });
  verifyFixtureResult_('S6', s6, function (row, task) {
    assert_('S6: 起票される', task !== null);
    if (!task) return;
    const draft = String(task[COL.TASK.REPLY_DRAFT - 1]);
    const template = getSettings_().firstReplyTemplate;
    console.log('S6: 返信提案(J列)=' + draft);
    if (template) {
      assert_('S6: 一次受け定型文が下書きされる', draft.indexOf(template) !== -1);
    } else {
      console.log('[SKIP] 設定シートの「一次受け定型文」が未登録のため、内容は目視確認');
    }
  });

  // 起票の重複防止: 同じ未分析状態に戻して再分析しても再起票されない
  const taskCountBefore = getSpreadsheet_().getSheetByName(SHEET.TASK).getLastRow();
  const s1Row = findLogRow_(s1);
  if (s1Row) {
    markAnalyzed_([s1Row.rowIndex], STATUS.ANALYSIS.PENDING);
    runAnalysisBatch();
    const taskCountAfter = getSpreadsheet_().getSheetByName(SHEET.TASK).getLastRow();
    assert_('同一messageIdからの再起票が防がれる', taskCountAfter === taskCountBefore,
      '再分析前: ' + taskCountBefore + '行 / 後: ' + taskCountAfter + '行');
  }
}

function verifyFixtureResult_(label, messageId, verifier) {
  const row = findLogRow_(messageId);
  if (!row) {
    assert_(label + ': ログ行が見つかる', false);
    return;
  }
  const status = String(row.values[COL.LOG.ANALYSIS_STATUS - 1]);
  assert_(label + ': 分析済になる', status === STATUS.ANALYSIS.DONE, 'L列=' + status);
  const taskId = String(row.values[COL.LOG.TASK_ID - 1] || '');
  verifier(row, taskId ? findTaskRow_(taskId) : null);
}

// ---------------------------------------------------------------------------
// P7: Dropbox保存系(Dropboxアプリ・リフレッシュトークンが必要。LINE不要)
// ---------------------------------------------------------------------------

/**
 * 固定Blobで日本語パスへのアップロード→共有リンク取得を2回実行する(§9.1)。
 * 初回(リンク新規作成)と2回目(409経路)の両方が同じURLを返せば合格。
 */
function test_uploadFixtureToDropbox() {
  const blob = Utilities.newBlob('Dropbox保存テスト ' + formatDateTime_(new Date()), 'text/plain');
  const path = buildDropboxPath_('テストサロン様', 'Ctestdropbox', Date.now(), 'testupload', '.txt');
  console.log('保存パス: ' + path);

  uploadToDropbox_(blob, path);
  const url1 = getOrCreateSharedLink_(path);
  console.log('1回目(新規作成): ' + url1);

  uploadToDropbox_(blob, path); // 同一パスへの再アップロード(overwriteで冪等)
  const url2 = getOrCreateSharedLink_(path); // 既存リンクあり → 409経路
  console.log('2回目(409経路): ' + url2);

  assert_('同一パスの共有リンクが一致する(冪等)', url1 === url2);
}
