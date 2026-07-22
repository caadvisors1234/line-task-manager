/**
 * test.gs — 手動テスト用(§9.1)
 * GASエディタから各 test_* 関数を実行し、ログ(console)とシートで結果を確認する。
 * 開発用スプレッドシート(SPREADSHEET_ID)に対して実行すること。本番シートでは実行しない。
 */

// テスト用の擬似ID(実在しないLINE ID。顧客マスタにはテスト実行時に自動登録される)
const TEST_GROUP_PREFIX = 'Ctest';
const TEST_CUSTOMER_USER_ID = 'Utestcustomer00000000000000000001';
const TEST_INTERNAL_USER_ID = 'Utestinternal00000000000000000001';
// 社内グループへのテスト発言用(自動追記されるため使い捨てIDにし、テスト末尾でリストから除去する)
const TEST_AUTO_USER_PREFIX = 'Utestauto';

// 画像分析テスト用のフィクスチャPNG(360x140。「TEST COUPON / 20% OFF CUT + COLOR /
// valid until 2026-08-31」と描画済み。Geminiが内容を読み取れたかの目視確認に使う)
const TEST_IMAGE_PNG_BASE64 =
  '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';

// 上記クーポンのJPEG版(360x140)。LINEの画像メッセージはJPEG固定(analysisImageMime_)のため、
// msgType='image' の経路には実体もJPEGのこちらを使う(PNG版は file+.png 拡張子の経路用)
const TEST_IMAGE_JPEG_BASE64 =
  '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' +
  '3tnbNUVDp3MBDPhDQLqtEHmSNssbo3i7XCxUQw6RzWxTVb5IG2/DygXt3Eq9EHGrg95pXw5suYbbXtrXYbERAREQEREBERAREQER' +
  'EBERAREQFJinZ0vh5hVqTFOzpfDzCk8HO95LXYwvs6Lx8yiYX2dF4+ZRI4F1yWez3XxPmopI4xmcbWF/qFnRRYrDGI4xlaNgu1bK' +
  'KTFdaW7qLVrFWY7Mnrf1kTrf1kWsiYc2dB1T5ZPW/rInW/rItZEw5mg6p8snrf1kTrf1kWsiYczQdU+WT1v6yJ1v6yLWRMOZoOqf' +
  'LJ639ZE639ZFrImHM0HVPlk9b+sidb+si1kTDmaDqnyyet/WROt/WRayJhzNB1T5ZPW/rInW/rItZEw5mg6p8snrf1kTrf1kWsiY' +
  'czQdU+WT1v6yJ1v6yLWRMOZoOqfLJ639ZE639ZFrImHM0HVPlk9b+sidb+si1kTDmaDqnyyet/WROt/WRayJhzNB1T5ZPW/rInW/' +
  'rItZEw5mg6p8snrf1kTrf1kWsiYczQdU+WT1v6yJ1v6yLWRMOZoOqfLJ639ZE639ZFrImHM0HVPlk9b+sidb+si1kTDmaDqnyyet' +
  '/WROt/WRayJhzNB1T5ZPW/rInW/rItZEw5mg6p8snrf1kXiWLFZozHIMzTtF2rZRMOaTcV1TanynoInw0UccgyuF7i/1KKhFp3sx' +
  'hiIh/9k=';

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
    originalText: '元の連絡文テスト1行目\n2行目',
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
  assert_('J列(元の連絡文)が改行を保って保存される',
    String(row1[COL.TASK.ORIGINAL_TEXT - 1]) === '元の連絡文テスト1行目\n2行目',
    JSON.stringify(String(row1[COL.TASK.ORIGINAL_TEXT - 1])));

  appendAttachmentLink_(id1, 'https://example.com/link1');
  appendAttachmentLink_(id1, 'https://example.com/link2');
  const g = String(findTaskRow_(id1)[COL.TASK.ATTACHMENT - 1]);
  assert_('G列への追記が既存内容を消さない(改行追加)',
    g === 'https://example.com/link1\nhttps://example.com/link2', JSON.stringify(g));

  const open = getOpenTasksBySalon_('テストサロン様');
  assert_('未完了タスクの取得に作成分が含まれる',
    open.some(function (t) { return t.taskId === id1; }));
}

/** buildDropboxPath_ のパス構成を確認する(純関数・API不要) */
function test_buildDropboxPath() {
  const ts = new Date(2025, 0, 19, 10, 30, 0).getTime();
  assert_('日付フォルダはゼロ埋めなし・サロン名直結',
    buildDropboxPath_('旭岡店', 'g1', ts, 'msg1', '.jpg') ===
      '/お客様/お預かり画像/2025.1.19旭岡店/20250119_103000_msg1.jpg',
    buildDropboxPath_('旭岡店', 'g1', ts, 'msg1', '.jpg'));
  assert_('サロン名未設定はグループID別のフォルダへ',
    buildDropboxPath_('', 'Cabc123', ts, 'msg2', '.png') ===
      '/お客様/お預かり画像/2025.1.19_未設定/Cabc123/20250119_103000_msg2.png',
    buildDropboxPath_('', 'Cabc123', ts, 'msg2', '.png'));
  assert_('サロン名のパス不可文字は _ に置換される',
    buildDropboxPath_('サロン/A:B', 'g1', ts, 'msg3', '') ===
      '/お客様/お預かり画像/2025.1.19サロン_A_B/20250119_103000_msg3',
    buildDropboxPath_('サロン/A:B', 'g1', ts, 'msg3', ''));
  assert_('parseDateTime_ が formatDateTime_ と往復一致する',
    formatDateTime_(parseDateTime_('2025-01-19 10:30:00')) === '2025-01-19 10:30:00',
    formatDateTime_(parseDateTime_('2025-01-19 10:30:00')));
}

/** truncateForCell_ の切り詰め動作を確認する(純関数・シート不要) */
function test_truncateForCell() {
  assert_('上限内はそのまま返す', truncateForCell_('短いテキスト') === '短いテキスト');
  assert_('null・undefinedは空文字になる',
    truncateForCell_(null) === '' && truncateForCell_(undefined) === '');
  const long = new Array(101).join('あいうえおかきくけこ'); // 1,000字
  const truncated = truncateForCell_(long, 100);
  assert_('上限超過は切り詰めて省略表記を付ける',
    truncated === long.slice(0, 100) + '\n…(以下省略)', String(truncated.length));
  assert_('既定上限(45,000字)以内の長文はそのまま返す',
    truncateForCell_(long) === long);
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

/** Flexのcontents木を再帰的にたどり、全textコンポーネントの文字列を収集する(検証用) */
function collectFlexTexts_(node, acc) {
  acc = acc || [];
  if (Array.isArray(node)) {
    node.forEach(function (child) { collectFlexTexts_(child, acc); });
  } else if (node && typeof node === 'object') {
    if (node.type === 'text') acc.push(String(node.text));
    Object.keys(node).forEach(function (key) {
      if (typeof node[key] === 'object') collectFlexTexts_(node[key], acc);
    });
  }
  return acc;
}

/** Flexサマリの構造・文言・切り詰め・0件時・サイズ上限を確認する(§4.4) */
function test_buildSummaryFlex() {
  const now = new Date();
  const today = formatDate_(now);
  const tasks = [
    { taskId: 'T-9001', dueText: '本日17:00', salonName: 'サロンB様', summary: 'キャンペーン用バナーの当日修正', status: STATUS.TASK.URGENT, needsReview: false, dueDate: today },
    { taskId: 'T-9002', dueText: '6/30〜7/1', salonName: '銀座整体院様', summary: '開始日変更の反映', status: STATUS.TASK.AWAITING_APPLY, needsReview: false, dueDate: formatDatePlusDays_(now, 1) },
    { taskId: 'T-9003', dueText: '毎月希望', salonName: 'アース大槻様', summary: 'インスタ投稿用画像の依頼', status: STATUS.TASK.TODO, needsReview: false, dueDate: '' },
    { taskId: 'T-9004', dueText: '', salonName: 'サロンC様', summary: '掲載文の修正依頼', status: STATUS.TASK.REQUESTED, needsReview: true, dueDate: '' },
    { taskId: 'T-9005', dueText: '', salonName: 'ガーデンウシワカマル様', summary: '看板画像の確認', status: STATUS.TASK.TODO, needsReview: false, dueDate: '' },
    { taskId: 'T-9006', dueText: '', salonName: 'サロンD様', summary: 'ロゴ差し替え', status: STATUS.TASK.AWAITING_CUSTOMER, needsReview: false, dueDate: '' },
    { taskId: 'T-9007', dueText: '', salonName: 'サロンE様', summary: 'クーポン修正', status: STATUS.TASK.AWAITING_CUSTOMER, needsReview: false, dueDate: '' }
  ];
  const options = {
    now: now, dueSoonDays: 3, maxItems: 15, errorCount: 1, unnamedGroupCount: 1,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/xxxx'
  };
  const flex = buildSummaryFlex_(tasks, options);
  const contents = flex.contents;
  console.log(JSON.stringify(contents));

  assert_('bubble構造(header/body/footer/styles)',
    contents.type === 'bubble' && !!contents.header && !!contents.body && !!contents.footer && !!contents.styles);
  assert_('ヘッダー帯が墨色', contents.styles.header.backgroundColor === FLEX_COLOR.INK);
  const button = contents.footer.contents[0];
  assert_('フッターボタンがシートURLを開く',
    button.action.type === 'uri' && button.action.uri === options.sheetUrl, JSON.stringify(button.action));
  assert_('ボタンがアクセント色', button.color === FLEX_COLOR.ACCENT);

  const texts = collectFlexTexts_(contents);
  assert_('区分の件数表示', texts.indexOf('2件') !== -1 && texts.indexOf('3件') !== -1);
  assert_('急ぎラベル付きタイトル', texts.indexOf('急ぎ｜サロンB様') !== -1);
  assert_('期限ラベル付きタイトル', texts.indexOf('期限｜銀座整体院様') !== -1);
  assert_('期限の補足行', texts.indexOf('期限: 本日17:00') !== -1);
  assert_('要確認の付記', texts.indexOf('※要確認') !== -1);
  assert_('件数のみ区分', texts.indexOf('お客様連絡待ち 2件｜反映待ち 1件') !== -1);
  assert_('分析失敗の表示', texts.indexOf('分析失敗1件(メッセージログを確認してください)') !== -1);
  assert_('空文字のtextコンポーネントがない(HTTP 400対策)',
    texts.every(function (t) { return t.length > 0; }));
  // 400字は自主上限(仕様上限は1,500字。通知欄で読める短さを保つ)
  assert_('altTextが件数入りの短文',
    flex.altText.indexOf('急ぎ・期限間近2件') !== -1 && flex.altText.length > 0 && flex.altText.length <= 400,
    flex.altText);
  assert_('JSONサイズが上限内',
    Utilities.newBlob(JSON.stringify(contents)).getBytes().length < 30 * 1024);

  // 切り詰め(サイズ対策。テキスト版と同じ規則)
  const truncated = buildSummaryFlex_(tasks, {
    now: now, dueSoonDays: 3, maxItems: 2, errorCount: 0, unnamedGroupCount: 0, sheetUrl: 'https://example.com'
  });
  assert_('最大表示件数での切り詰め',
    collectFlexTexts_(truncated.contents).indexOf('ほか1件はシート参照') !== -1);

  // 0件時(毎朝同じ構造のbubbleが届く)
  const empty = buildSummaryFlex_([], {
    now: now, dueSoonDays: 3, maxItems: 15, errorCount: 0, unnamedGroupCount: 0, sheetUrl: 'https://example.com'
  });
  const emptyTexts = collectFlexTexts_(empty.contents);
  assert_('0件時も「なし」表示で同構造のbubbleが生成される',
    empty.contents.type === 'bubble' && emptyTexts.indexOf('なし') !== -1 && emptyTexts.indexOf('0件') !== -1);

  // 外部ブラウザで開くためのパラメータ付与(LINE内ブラウザのGoogle未ログイン対策)
  assert_('外部ブラウザ用パラメータの付与',
    externalBrowserUrl_('https://docs.google.com/spreadsheets/d/x/edit') ===
      'https://docs.google.com/spreadsheets/d/x/edit?openExternalBrowser=1' &&
    externalBrowserUrl_('https://example.com/?a=1') === 'https://example.com/?a=1&openExternalBrowser=1');
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
  // 発言者は使い捨てID(社内グループの発言者は自社メンバーリストへ自動追記されるため、
  // TEST_CUSTOMER_USER_ID を使うと以後のテストで発言者区分の判定が壊れる)
  if (entry) {
    getSpreadsheet_().getSheetByName(SHEET.MASTER)
      .getRange(entry.rowIndex, COL.MASTER.STATE).setValue(STATUS.MASTER.INTERNAL);
    try {
      const before = logRowCount_();
      callDoPost_([makeTextEvent_(groupId, TEST_AUTO_USER_PREFIX + suffix, '社内グループのテスト発言')]);
      assert_('社内グループの発言はログ・分析の対象外', logRowCount_() === before);
    } finally {
      removeInternalUserIdsByPrefix_(TEST_AUTO_USER_PREFIX);
    }
  }
}

/** テスト用: 自社メンバーuserIDリストから指定プレフィックスのIDを取り除く(自動追記の後片付け) */
function removeInternalUserIdsByPrefix_(prefix) {
  // appendInternalUserId_と同じセルを書き換えるため、同様にロックで保護する
  withScriptLock_(function () {
    const sheet = getSpreadsheet_().getSheetByName(SHEET.SETTINGS);
    const found = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
      .createTextFinder(SETTING_KEY.INTERNAL_USER_IDS).matchEntireCell(true).findNext();
    if (!found) return;
    const cell = sheet.getRange(found.getRow(), 2);
    const remaining = String(cell.getValue() || '').split(/[,、\s\n]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (id) { return id && id.indexOf(prefix) !== 0; });
    cell.setValue(asCellText_(remaining.join(',')));
    SpreadsheetApp.flush();
    settingsMemo_ = null;
  });
}

/** 社内グループの発言者が自社メンバーuserIDリストへ自動追記されることを確認する(§3.4) */
function test_simulateInternalSpeakerAutoRegister() {
  const suffix = Utilities.getUuid().replace(/-/g, '').substring(0, 24);
  const internalGroupId = ensureTestGroup_('auto' + suffix, '(社内テスト)');
  const internalEntry = resolveSalonName_(internalGroupId);
  getSpreadsheet_().getSheetByName(SHEET.MASTER)
    .getRange(internalEntry.rowIndex, COL.MASTER.STATE).setValue(STATUS.MASTER.INTERNAL);
  const userId = TEST_AUTO_USER_PREFIX + suffix;

  try {
    // 1. 未登録IDで社内グループ発言 → リストへ追記され、ログは増えない
    const beforeLog = logRowCount_();
    callDoPost_([makeTextEvent_(internalGroupId, userId, '自動登録のテスト発言')]);
    settingsMemo_ = null;
    assert_('社内グループの発言者がリストへ自動追記される', getInternalUserIds_().indexOf(userId) !== -1);
    assert_('社内グループの発言はログに残らないまま', logRowCount_() === beforeLog);

    // 2. 登録済みIDの再発言 → 重複追記されない
    callDoPost_([makeTextEvent_(internalGroupId, userId, '自動登録のテスト発言(2回目)')]);
    settingsMemo_ = null;
    const occurrences = getInternalUserIds_().filter(function (id) { return id === userId; }).length;
    assert_('登録済みIDは重複追記されない', occurrences === 1, '出現回数: ' + occurrences);

    // 3. 2人目の発言 → 既存のIDを消さずに追記される(連結でなく上書きになる退行の検出)
    const secondUserId = TEST_AUTO_USER_PREFIX + 'y' + suffix;
    callDoPost_([makeTextEvent_(internalGroupId, secondUserId, '自動登録のテスト発言(2人目)')]);
    settingsMemo_ = null;
    assert_('2人目が追記され、1人目のIDも残る',
      getInternalUserIds_().indexOf(userId) !== -1 && getInternalUserIds_().indexOf(secondUserId) !== -1);

    // 4. 通常グループ(状態「有効」)の発言 → 追記されず、ログには残る
    const customerGroupId = ensureTestGroup_('text0000000000000000000000001', 'テストサロン様');
    const otherUserId = TEST_AUTO_USER_PREFIX + 'x' + suffix;
    const event = makeTextEvent_(customerGroupId, otherUserId, '通常グループのテスト発言');
    callDoPost_([event]);
    settingsMemo_ = null;
    assert_('通常グループの発言者は追記されない', getInternalUserIds_().indexOf(otherUserId) === -1);
    assert_('通常グループの発言はログに残る', findLogRow_(event.message.id) !== null);
  } finally {
    // 後片付け(開発シートの設定値がテストのたびに肥大しないように)
    removeInternalUserIdsByPrefix_(TEST_AUTO_USER_PREFIX);
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

/**
 * フィクスチャ会話をログへ直接投入する(doPost・LINEを経由しない)。
 * overrides(省略可): recordへ上書きマージする項目({ msgType: 'image', dropboxLink: url } 等)。
 * 受信日時はまとめ待機(§4.3 ANALYSIS_COOLDOWN_MS)より前に遡らせる。現在時刻で投入すると
 * 直後の runAnalysisBatch() が「後続メッセージ待ち」と判断して何も分析しないため。
 */
function insertFixtureLog_(groupId, salonName, speakerType, text, overrides) {
  const messageId = 'testmsg' + Utilities.getUuid().replace(/-/g, '');
  const record = {
    receivedAt: formatDateTime_(new Date(Date.now() - CONFIG.ANALYSIS_COOLDOWN_MS - 60 * 1000)),
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
  };
  if (overrides) {
    Object.keys(overrides).forEach(function (key) { record[key] = overrides[key]; });
  }
  withScriptLock_(function () {
    appendMessageLog_(record);
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

/** 関連メッセージのまとめ待機(クールダウン)の判定を確認する(Gemini・シート不要。§4.3) */
function test_isGroupReadyForAnalysis() {
  const now = Date.now();
  const at = function (msAgo) { return { receivedAt: formatDateTime_(new Date(now - msAgo)) }; };

  assert_('直後に届いたメッセージは後続を待って持ち越す',
    isGroupReadyForAnalysis_([at(10 * 1000)], now) === false);
  assert_('まとめ待機を過ぎたグループは分析する',
    isGroupReadyForAnalysis_([at(CONFIG.ANALYSIS_COOLDOWN_MS + 30 * 1000)], now) === true);
  assert_('古い依頼でも直後に発言が続いていれば待つ',
    isGroupReadyForAnalysis_([at(5 * 60 * 1000), at(5 * 1000)], now) === false);
  assert_('最古が持ち越し上限を超えたら発言が続いていても分析する(滞留防止)',
    isGroupReadyForAnalysis_([at(CONFIG.ANALYSIS_MAX_DEFER_MS + 60 * 1000), at(5 * 1000)], now) === true);
}

/**
 * 関連メッセージのまとめ起票(§4.3)の結合テスト。
 * 「TOP画像を変えたい」という依頼文とその画像を続けて投入し、1タスクにまとまるか検証する。
 * 実行前提: GEMINI_API_KEY・Dropbox設定済み。
 */
function test_runAnalysisOnMergeFixture() {
  const cleared = clearPendingAnalysisRows_();
  if (cleared > 0) console.log('前処理: 過去テストの未分析 ' + cleared + ' 行を分析対象外にしました');

  const jpegUrl = uploadTestImageFixture_(TEST_IMAGE_JPEG_BASE64, '.jpg', 'image/jpeg');
  const groupId = ensureTestGroup_('fixmerge0000000000000000000001', 'テストサロン結合様');
  const m1 = insertFixtureLog_(groupId, 'テストサロン結合様', SPEAKER.CUSTOMER,
    'TOP画像を変更したいです。こちらの画像に差し替えをお願いします。');
  const m2 = insertFixtureLog_(groupId, 'テストサロン結合様', SPEAKER.CUSTOMER, '',
    { msgType: 'image', dropboxLink: jpegUrl });

  runAnalysisBatch();

  const row1 = findLogRow_(m1);
  const row2 = findLogRow_(m2);
  assert_('まとめ: 依頼文・画像の両方が分析済になる',
    row1 !== null && row2 !== null &&
    String(row1.values[COL.LOG.ANALYSIS_STATUS - 1]) === STATUS.ANALYSIS.DONE &&
    String(row2.values[COL.LOG.ANALYSIS_STATUS - 1]) === STATUS.ANALYSIS.DONE);
  if (!row1 || !row2) return;

  const taskId1 = String(row1.values[COL.LOG.TASK_ID - 1] || '');
  const taskId2 = String(row2.values[COL.LOG.TASK_ID - 1] || '');
  assert_('まとめ: 依頼文と画像が1つのタスクにまとまる', taskId1 !== '' && taskId1 === taskId2,
    '依頼文=' + taskId1 + ' / 画像=' + taskId2 + ' / M列=' + row1.values[COL.LOG.ANALYSIS_JSON - 1]);
  if (!taskId1 || taskId1 !== taskId2) return;

  const task = findTaskRow_(taskId1);
  if (!task) {
    assert_('まとめ: タスク行が見つかる', false, taskId1);
    return;
  }
  const sourceIds = String(task[COL.TASK.SOURCE_MESSAGE_ID - 1]).split(',');
  assert_('まとめ: 起票元messageIdに両方のIDが記録される',
    sourceIds.length === 2 && sourceIds.indexOf(m1) !== -1 && sourceIds.indexOf(m2) !== -1,
    String(task[COL.TASK.SOURCE_MESSAGE_ID - 1]));
  assert_('まとめ: 画像の共有リンクが議事録・添付資料(G列)に入る',
    String(task[COL.TASK.ATTACHMENT - 1]).indexOf('http') === 0,
    String(task[COL.TASK.ATTACHMENT - 1]));
  const originalText = String(task[COL.TASK.ORIGINAL_TEXT - 1]);
  assert_('まとめ: 元の連絡文(J列)に依頼文と画像のメタ表現が改行区切りで入る',
    originalText === 'TOP画像を変更したいです。こちらの画像に差し替えをお願いします。\n(画像を受信)',
    JSON.stringify(originalText));
  console.log('まとめ: 作業内容(F列)=' + task[COL.TASK.SUMMARY - 1] +
    '\n※TOP画像の差し替え依頼として1件にまとまり、画像の内容が反映されているか目視確認');

  // 再起票防止: カンマ連結された起票元messageIdからでも既存タスクを引けること。
  // 行数だけの検証では、再分析でneedsTask=falseと判定された場合に照合を通らないまま合格し得るため、
  // 元のタスクIDが引けている(=照合が実際に成立した)ことまで確認する
  const taskCountBefore = getSpreadsheet_().getSheetByName(SHEET.TASK).getLastRow();
  markAnalyzed_([row2.rowIndex], STATUS.ANALYSIS.PENDING);
  runAnalysisBatch();
  const taskCountAfter = getSpreadsheet_().getSheetByName(SHEET.TASK).getLastRow();
  const row2After = findLogRow_(m2);
  assert_('まとめ: カンマ連結の起票元IDでも再起票が防がれる',
    taskCountAfter === taskCountBefore && row2After !== null &&
    String(row2After.values[COL.LOG.TASK_ID - 1]) === taskId1,
    '再分析前: ' + taskCountBefore + '行 / 後: ' + taskCountAfter + '行 / 起票タスクID=' +
    (row2After ? row2After.values[COL.LOG.TASK_ID - 1] : '(行なし)') + ' / 期待=' + taskId1);
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
    assert_('S1: 元の連絡文(J列)にメッセージ本文が入る',
      String(task[COL.TASK.ORIGINAL_TEXT - 1]) === 'クーポン画像を金曜までに差し替えてください',
      String(task[COL.TASK.ORIGINAL_TEXT - 1]));
    console.log('S1: 期限(S列)=' + task[COL.TASK.DUE_DATE - 1] + '(直近の金曜日付になっているか目視確認)');
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
    console.log('S6: 返信提案(K列)=' + draft);
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

// ---------------------------------------------------------------------------
// 画像マルチモーダル分析(§4.3・§5.1。test_downloadSharedLinkFile / test_collectAnalysisImages は
// Dropboxのみ、test_runAnalysisOnImageFixture は Dropbox+Gemini が必要)
// ---------------------------------------------------------------------------

/** フィクスチャ画像をDropboxへアップロードし共有リンクを返す(固定タイムスタンプで冪等) */
function uploadTestImageFixture_(base64Data, extension, mime) {
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mime);
  const path = buildDropboxPath_('テストサロン様', 'Ctestdropbox', 1767225600000, 'testimagefixture', extension);
  uploadToDropbox_(blob, path);
  return getOrCreateSharedLink_(path);
}

/** 共有リンク経由のダウンロードが元データを完全復元することを確認する(合意事項1の裏取り) */
function test_downloadSharedLinkFile() {
  const url = uploadTestImageFixture_(TEST_IMAGE_PNG_BASE64, '.png', 'image/png');
  console.log('共有リンク: ' + url);
  const bytes = downloadSharedLinkFile_(url).getBytes();
  assert_('共有リンク経由のダウンロードが元データと一致する',
    Utilities.base64Encode(bytes) === TEST_IMAGE_PNG_BASE64,
    'バイト数=' + bytes.length);
}

/** 画像収集の判定・枚数上限・フォールバックを確認する(Gemini不要) */
function test_collectAnalysisImages() {
  // 対象判定(ネットワーク不要)
  assert_('image はjpeg固定', analysisImageMime_({ msgType: 'image', body: '' }) === 'image/jpeg');
  assert_('file の大文字PNG拡張子', analysisImageMime_({ msgType: 'file', body: 'レポート.PNG' }) === 'image/png');
  assert_('file のPDFは対象外', analysisImageMime_({ msgType: 'file', body: '資料.pdf' }) === null);
  assert_('拡張子なしの file は対象外', analysisImageMime_({ msgType: 'file', body: 'ファイル名' }) === null);
  assert_('text は対象外', analysisImageMime_({ msgType: 'text', body: '画像.png' }) === null);

  const jpegUrl = uploadTestImageFixture_(TEST_IMAGE_JPEG_BASE64, '.jpg', 'image/jpeg');
  const pngUrl = uploadTestImageFixture_(TEST_IMAGE_PNG_BASE64, '.png', 'image/png');
  const badUrl = 'https://www.dropbox.com/scl/fi/notfound0000000000000/none.png?rlkey=none&dl=0';
  const images = collectAnalysisImages_([
    { messageId: 'img1', msgType: 'image', body: '', dropboxLink: jpegUrl },
    { messageId: 'img2', msgType: 'image', body: '', dropboxLink: jpegUrl },
    { messageId: 'img3', msgType: 'image', body: '', dropboxLink: badUrl }, // 実在しないリンク
    { messageId: 'file4', msgType: 'file', body: 'クーポン案.png', dropboxLink: pngUrl },
    { messageId: 'img5', msgType: 'image', body: '', dropboxLink: jpegUrl }, // 4枚目=枚数上限超過
    { messageId: 'img6', msgType: 'image', body: '', dropboxLink: CONTENT_NOTE.SKIPPED }, // 未保存マーカー
    { messageId: 'text7', msgType: 'text', body: 'テキスト', dropboxLink: '' }
  ]);

  assert_('上限3枚まで会話順に添付され連番が振られる',
    images.attachedIndex.img1 === 1 && images.attachedIndex.img2 === 2 && images.attachedIndex.file4 === 3,
    JSON.stringify(images.attachedIndex));
  assert_('parts数=添付3枚×(ラベル+inline_data)', images.parts.length === 6);
  assert_('inline_dataのMIMEタイプ(image=jpeg固定・file=拡張子準拠)と中身',
    images.parts[1].inline_data.mime_type === 'image/jpeg' &&
    images.parts[5].inline_data.mime_type === 'image/png' &&
    images.parts[1].inline_data.data === TEST_IMAGE_JPEG_BASE64 &&
    images.parts[5].inline_data.data === TEST_IMAGE_PNG_BASE64);
  assert_('実在しないリンクは例外を投げずフォールバック', images.fallback.img3 === true);
  assert_('枚数上限超過分はフォールバック', images.fallback.img5 === true && !images.attachedIndex.img5);
  assert_('未保存マーカー行はダウンロードせずフォールバック', images.fallback.img6 === true);
  assert_('画像でない行はどちらにも載らない', !images.fallback.text7 && !images.attachedIndex.text7);
}

/**
 * 画像つき分析の結合テスト(S5拡張のフィクスチャ版)。
 * image経路・file画像拡張子経路・取得失敗フォールバックの3グループを投入し、
 * 分析完了とタスク起票を検証する。summaryへの画像内容の反映は console 出力を目視確認する。
 */
function test_runAnalysisOnImageFixture() {
  const cleared = clearPendingAnalysisRows_();
  if (cleared > 0) console.log('前処理: 過去テストの未分析 ' + cleared + ' 行を分析対象外にしました');

  // 画像メッセージ経路はMIME宣言(image/jpeg固定)と実体を一致させるためJPEG版を使う
  const jpegUrl = uploadTestImageFixture_(TEST_IMAGE_JPEG_BASE64, '.jpg', 'image/jpeg');
  const pngUrl = uploadTestImageFixture_(TEST_IMAGE_PNG_BASE64, '.png', 'image/png');

  // SI1: 画像メッセージ単独の送付(資料送付・新規依頼として画像の中身から起票判断)
  const g1 = ensureTestGroup_('fiximg100000000000000000000001', 'テストサロン画像1様');
  const i1 = insertFixtureLog_(g1, 'テストサロン画像1様', SPEAKER.CUSTOMER, '',
    { msgType: 'image', dropboxLink: jpegUrl });

  // SI2: 画像をファイルとして送付(file+画像拡張子の経路)
  const g2 = ensureTestGroup_('fiximg200000000000000000000001', 'テストサロン画像2様');
  const i2 = insertFixtureLog_(g2, 'テストサロン画像2様', SPEAKER.CUSTOMER, 'クーポン案.png',
    { msgType: 'file', dropboxLink: pngUrl });

  // SI3: 共有リンクが実在しない(取得失敗→メタ情報のみで分析続行の確認)
  const g3 = ensureTestGroup_('fiximg300000000000000000000001', 'テストサロン画像3様');
  const i3 = insertFixtureLog_(g3, 'テストサロン画像3様', SPEAKER.CUSTOMER, '',
    { msgType: 'image', dropboxLink: 'https://www.dropbox.com/scl/fi/notfound0000000000000/none.png?rlkey=none&dl=0' });

  const errorSheet = getSpreadsheet_().getSheetByName(SHEET.ERROR_LOG);
  const errorRowsBefore = errorSheet ? errorSheet.getLastRow() : 0;

  runAnalysisBatch();

  // 画像起因400の画像なし再実行を経由していないこと
  // (経由すると画像を読ませないままSI1・SI2が合格し得るため、発生を検知して失敗させる)
  if (errorSheet) {
    let image400 = false;
    const newErrorRows = errorSheet.getLastRow() - errorRowsBefore;
    if (newErrorRows > 0) {
      errorSheet.getRange(errorRowsBefore + 1, COL.ERROR.CONTEXT, newErrorRows, 1).getValues()
        .forEach(function (row) {
          if (String(row[0]).indexOf('image400') !== -1) image400 = true;
        });
    }
    assert_('画像つき分析が画像なしフォールバック(image400)を経由していない', !image400);
  }

  verifyFixtureResult_('SI1', i1, function (row, task) {
    assert_('SI1: 画像メッセージから起票される', task !== null,
      row ? 'M列=' + row.values[COL.LOG.ANALYSIS_JSON - 1] : '');
    console.log('SI1: 分析結果(M列)=' + row.values[COL.LOG.ANALYSIS_JSON - 1] +
      '\n※summary・replyDraftにクーポン画像の内容(TEST COUPON / 20% OFF等)が反映されているか目視確認');
  });
  verifyFixtureResult_('SI2', i2, function (row, task) {
    assert_('SI2: 画像ファイルから起票される', task !== null,
      row ? 'M列=' + row.values[COL.LOG.ANALYSIS_JSON - 1] : '');
    console.log('SI2: 分析結果(M列)=' + row.values[COL.LOG.ANALYSIS_JSON - 1]);
  });
  const badRow = findLogRow_(i3);
  assert_('SI3: 画像取得に失敗しても分析済で完了する',
    badRow !== null && badRow.values[COL.LOG.ANALYSIS_STATUS - 1] === STATUS.ANALYSIS.DONE,
    badRow ? 'L列=' + badRow.values[COL.LOG.ANALYSIS_STATUS - 1] : '');
  assert_('SI3: 取得失敗で分析試行回数を消費しない',
    badRow !== null && Number(badRow.values[COL.LOG.RETRY_COUNT - 1] || 0) === 0);

  // 再分析の冪等性: 画像つきでも同一messageIdからの再起票が防がれる
  const taskCountBefore = getSpreadsheet_().getSheetByName(SHEET.TASK).getLastRow();
  const i1Row = findLogRow_(i1);
  if (i1Row) {
    markAnalyzed_([i1Row.rowIndex], STATUS.ANALYSIS.PENDING);
    runAnalysisBatch();
    const taskCountAfter = getSpreadsheet_().getSheetByName(SHEET.TASK).getLastRow();
    assert_('画像メッセージの再分析でも再起票されない', taskCountAfter === taskCountBefore,
      '再分析前: ' + taskCountBefore + '行 / 後: ' + taskCountAfter + '行');
  }
}
