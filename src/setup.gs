/**
 * setup.gs — 初期構築ワンタイム関数(§8.3・§8.4)
 * setupSpreadsheet() はシート単位で冪等(既存シートには一切触れない)。
 * 再生成したい場合は対象シートを手動削除してから再実行する。
 *
 * ヘッダーの表示文言・セルメモ・見出し色はこのファイルに集約する(表示レイヤーのみ。
 * コードは COL の列番号で動作し、ヘッダー文字列には依存しない。§3.1・§3.2)。
 */

// タスク状況→行の色(§3.1。fontColor省略時は黒、strikethroughは対象外のみ)
const TASK_STATUS_STYLES = [
  { status: '依頼中', background: '#f4cccc' },
  { status: '作業完了・未チェック', background: '#f4921e' },
  { status: 'チェック完了・残りお客様連絡', background: '#ec47dd', fontColor: '#ffffff' },
  { status: 'タスク完了済み', background: '#b7b7b7' },
  { status: '佐藤さん提出', background: '#ffe14d' },
  { status: '急ぎの対応', background: '#ff2b22', fontColor: '#ffffff' },
  { status: '反映待ち', background: '#4a86d8', fontColor: '#ffffff' },
  { status: 'お客様連絡待ち', background: '#b6d7a8' },
  { status: '対象外', background: '#d9d9d9', strikethrough: true }
  // 「未対応」は白(既定色)のためルール不要
];

// ヘッダー見出しの塗り分け: 緑=人が記入・更新する列 / 墨色=AIが自動記入する列
const HEADER_STYLE = {
  HUMAN_BG: '#d9f2e5',
  HUMAN_FONT: '#24292e',
  AI_BG: '#24292e',
  AI_FONT: '#ffffff'
};

// 各シートのヘッダー定義: { name: 見出し, human: 人が記入・更新する列, note: セルメモ }
// タスク一覧(§3.1)。A〜Jは既存業務シートの列名を踏襲、K〜R(非表示管理列)は平易名
const TASK_HEADER_DEFS = [
  { name: '対応期日', human: true,
    note: '【記入する人】メッセージから読み取れた場合にAIが初期値を記入します。確定・変更は担当者が行ってください(AIは上書きしません)。\n【内容】対応の期日。自由な書き方で構いません。\n【例】本日17:00／6/30〜7/1の間で更新' },
  { name: '納品データ', human: true,
    note: '【記入する人】担当者が記入します。AIは一切書き込みません。\n【内容】当社が制作・納品したデータのリンクなど。\n【例】https://www.dropbox.com/...' },
  { name: '担当者名', human: true,
    note: '【記入する人】担当者が記入します。AIは一切書き込みません。\n【内容】このタスクを対応する社内メンバーの名前。\n【例】山田' },
  { name: '店舗名',
    note: '【記入する人】AIが自動記入します(顧客マスタから引き当て)。\n【内容】依頼元のサロン名。空欄の場合は顧客マスタのサロン名を記入してください。\n【例】サロンA様' },
  { name: 'メッセージ種別',
    note: '【記入する人】AIが自動記入します。\n【内容】新規依頼／回答・承認／質問・確認／資料送付 のいずれか。\n【例】新規依頼' },
  { name: '作業内容',
    note: '【記入する人】AIが自動記入します。\n【内容】依頼内容の1行まとめ。\n【例】ホットペッパー広告バナーの差し替え' },
  { name: '議事録・添付資料',
    note: '【記入する人】AIと担当者の両方。AIは受信した画像・ファイルの保存先リンクを追記します(既存の内容は消しません)。\n【内容】議事録や資料のリンク。\n【例】https://www.dropbox.com/...' },
  { name: 'タスク状況(進捗)', human: true,
    note: '【記入する人】登録時にAIが初期値(未対応または反映待ち)を入れます。以後の更新は担当者がプルダウンから選んでください。\n【内容】値を変えると行全体の色が自動で変わります。\n【例】作業が終わったら「作業完了・未チェック」に変更' },
  { name: 'タスク発生日',
    note: '【記入する人】AIが自動記入します。\n【内容】タスクの発生日と発生元。\n【例】7/14 LINE' },
  { name: '返信提案',
    note: '【記入する人】AIが自動記入します。\n【内容】お客様への返信の下書き。内容を確認のうえ、送信は担当者が行ってください。' },
  { name: 'タスクID(自動採番)',
    note: '【記入する人】AIが自動記入します(システム用)。編集しないでください。\n【内容】タスクの通し番号。\n【例】T-0001' },
  { name: 'LINEグループID(システム用)',
    note: '【記入する人】AIが自動記入します(システム用)。編集しないでください。' },
  { name: '緊急度(AI判定)',
    note: '【記入する人】AIが自動記入します。\n【内容】AIが判定した緊急度(高・中・低)。' },
  { name: '関連タスクID',
    note: '【記入する人】AIが自動記入します。\n【内容】このタスクが既存タスクへの回答・承認の場合、元タスクのID。' },
  { name: '要確認(AIの自信が低い印)',
    note: '【記入する人】AIが自動記入します。\n【内容】AIの判定に自信がない印。朝の通知に「※要確認」と表示されます。' },
  { name: '登録元メッセージID(システム用)',
    note: '【記入する人】AIが自動記入します(システム用)。編集しないでください。\n【内容】このタスクの元になったLINEメッセージのID。二重登録の防止に使います。' },
  { name: 'タスク登録日時',
    note: '【記入する人】AIが自動記入します(システム用)。編集しないでください。' },
  { name: '期限(システム用)',
    note: '【記入する人】AIが自動記入します(システム用)。編集しないでください。\n【内容】AIが読み取った期限(yyyy-MM-dd)。朝の通知の「急ぎ・期限間近」の判定に使います。' }
];

// メッセージログ(§3.2)。全列AIの自動記録
const LOG_HEADER_DEFS = [
  { name: '受信日時', note: '【記入する人】自動で記録されます。\n【内容】メッセージを受信した日時。' },
  { name: 'LINEグループID(システム用)', note: '【記入する人】自動で記録されます(システム用)。編集しないでください。' },
  { name: 'サロン名', note: '【記入する人】顧客マスタから自動で引き当てます。\n【内容】空欄の場合は顧客マスタのサロン名を記入してください(それ以降は自動で入ります)。' },
  { name: '発言者の区分(自社／お客様)', note: '【記入する人】自動で判定されます(設定シートの「自社メンバーuserIDリスト」を使用)。' },
  { name: '発言者ID(システム用)', note: '【記入する人】自動で記録されます(システム用)。編集しないでください。' },
  { name: '発言者の表示名', note: '【記入する人】自動で記録されます。\n【内容】LINE上の表示名。取得できない場合は「(取得不可)」。' },
  { name: 'メッセージの種類', note: '【記入する人】自動で記録されます。\n【内容】text(テキスト)／image(画像)／file(ファイル)など。' },
  { name: 'メッセージ本文', note: '【記入する人】自動で記録されます。\n【内容】テキストの本文。画像・ファイルはファイル名などの情報。' },
  { name: 'メッセージID(システム用)', note: '【記入する人】自動で記録されます(システム用)。編集しないでください。\n【内容】重複排除・画像等の取得に使います。' },
  { name: '受信イベントID(システム用)', note: '【記入する人】自動で記録されます(システム用)。編集しないでください。\n【内容】重複排除に使います。' },
  { name: '保存ファイルのリンク(Dropbox)', note: '【記入する人】自動で記録されます。\n【内容】受信した画像・ファイルの保存先リンク。' },
  { name: 'AI分析の状態', note: '【記入する人】自動で更新されます。\n【内容】未分析→分析済 の順に変わります。自社の発言は「分析対象外」。「エラー」が続く場合は管理者に連絡してください。' },
  { name: 'AI分析の詳細データ(システム用)', note: '【記入する人】自動で記録されます(システム用)。編集しないでください。' },
  { name: '登録されたタスクID', note: '【記入する人】自動で記録されます。\n【内容】このメッセージから登録・紐付けされたタスクのID。' },
  { name: 'AI分析の試行回数(システム用)', note: '【記入する人】自動で記録されます(システム用)。編集しないでください。' }
];

// 顧客マスタ(§3.3)
const MASTER_HEADER_DEFS = [
  { name: 'グループID',
    note: '【記入する人】自動で記入されます(システム用)。BotがLINEグループに招待されると行が追加されます。' },
  { name: 'サロン名', human: true,
    note: '【記入する人】Bot参加時にLINEのグループ名が自動で入ります。表記を変えたい場合は上書きしてください(以後、自動では変更されません)。\n【内容】タスクや通知に表示されるサロン名。空欄の場合はここに記入すると運用に乗ります。\n【例】サロンA様' },
  { name: '状態', human: true,
    note: '【記入する人】通常は自動(Bot退出時に「退出」へ)。社内の通知用・テスト用グループは担当者が「社内」に変更してください(お客様向けの記録・分析の対象外になります)。' },
  { name: 'Bot参加日', note: '【記入する人】自動で記入されます。' },
  { name: '備考', human: true, note: '【記入する人】担当者が自由に記入できます。' }
];

// 設定(§3.4)
const SETTINGS_HEADER_DEFS = [
  { name: '項目名', note: '【記入する人】変更しないでください。プログラムがこの名前で項目を参照しています。' },
  { name: '値', human: true, note: '【記入する人】管理者が調整します。変更はすぐに反映されます。' },
  { name: '説明' }
];

// 返信テンプレート(§3.5)
const TEMPLATE_HEADER_DEFS = [
  { name: 'パターン名', human: true,
    note: '【記入する人】管理者が記入します。\n【内容】返信文例のパターン名。AIがこの文例を参考に「返信提案」を作ります。\n【例】画像差し替え依頼への受領連絡' },
  { name: '適用の目安', human: true,
    note: '【記入する人】管理者が記入します。\n【内容】どんな依頼に使う文例かの説明。' },
  { name: 'テンプレート本文', human: true,
    note: '【記入する人】管理者が記入します。\n【内容】返信例の全文。' },
  { name: '備考', human: true }
];

// エラーログ
const ERROR_HEADER_DEFS = [
  { name: '発生日時', note: 'システムが自動で記録します。通常は開く必要はありません。' },
  { name: 'コンテキスト' },
  { name: 'エラーメッセージ' },
  { name: 'スタックトレース' }
];

// 使い方シートのタスク状況凡例(意味の説明。色は TASK_STATUS_STYLES を再利用)。
// 並びは TASK_STATUS_ORDER と一致させる
const GUIDE_STATUS_MEANINGS = [
  { status: '未対応', meaning: '着手前の案件(登録時の初期値)' },
  { status: '依頼中', meaning: '対応を依頼し、返答・作業待ち' },
  { status: '作業完了・未チェック', meaning: '作業は完了、社内チェック前' },
  { status: 'チェック完了・残りお客様連絡', meaning: 'チェック済み。あとはお客様へ連絡' },
  { status: 'タスク完了済み', meaning: 'すべて完了・クローズ' },
  { status: '佐藤さん提出', meaning: '佐藤さんからの提出・確認待ち' },
  { status: '急ぎの対応', meaning: '最優先。対応期日に赤字で期限を記入' },
  { status: '反映待ち', meaning: '下書き登録後、連絡まで完了したもの' },
  { status: 'お客様連絡待ち', meaning: 'お客様からの連絡待ち' },
  { status: '対象外', meaning: 'AIが誤って登録したもの。削除せずこの値に変更' }
];

/** 全シート・プルダウン・条件付き書式・非表示列を生成する(GASエディタから手動実行) */
function setupSpreadsheet() {
  const ss = getSpreadsheet_();
  createSheetIfMissing_(ss, SHEET.GUIDE, buildGuideSheet_, 0);
  createSheetIfMissing_(ss, SHEET.TASK, buildTaskSheet_);
  createSheetIfMissing_(ss, SHEET.LOG, buildLogSheet_);
  createSheetIfMissing_(ss, SHEET.MASTER, buildMasterSheet_);
  createSheetIfMissing_(ss, SHEET.SETTINGS, buildSettingsSheet_);
  createSheetIfMissing_(ss, SHEET.TEMPLATE, buildTemplateSheet_);
  createSheetIfMissing_(ss, SHEET.ERROR_LOG, buildErrorLogSheet_);

  // タスクID採番カウンタは未設定のときのみ初期化(再実行で採番を巻き戻さない)
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(CONFIG.PROP.TASK_ID_SEQ) === null) {
    props.setProperty(CONFIG.PROP.TASK_ID_SEQ, '0');
    console.log('タスクID採番カウンタを初期化しました(TASK_ID_SEQ=0)');
  }
  console.log('setupSpreadsheet 完了');
}

/**
 * シートが存在しなければ作成してbuilderを適用、存在すれば完全スキップ。
 * index を指定するとタブ位置を指定して作成する(0=先頭。既存シートの位置は変えない)。
 */
function createSheetIfMissing_(ss, name, builder, index) {
  if (ss.getSheetByName(name)) {
    console.log('シート「' + name + '」は既存のためスキップ');
    return;
  }
  const sheet = index === undefined ? ss.insertSheet(name) : ss.insertSheet(name, index);
  builder(sheet);
  console.log('シート「' + name + '」を作成');
}

/**
 * ヘッダー行を設定する。defs: [{ name, human, note }]
 * 見出しは緑(人が記入・更新する列)と墨色(AIが自動記入する列)に塗り分け、
 * メモで「何が入るか・誰が書くか・記入例」を示す(色ルールの凡例は使い方シート)。
 */
function setHeader_(sheet, defs) {
  const range = sheet.getRange(1, 1, 1, defs.length);
  range.setValues([defs.map(function (d) { return d.name; })]);
  range.setFontWeight('bold');
  range.setBackgrounds([defs.map(function (d) { return d.human ? HEADER_STYLE.HUMAN_BG : HEADER_STYLE.AI_BG; })]);
  range.setFontColors([defs.map(function (d) { return d.human ? HEADER_STYLE.HUMAN_FONT : HEADER_STYLE.AI_FONT; })]);
  range.setNotes([defs.map(function (d) { return d.note || null; })]);
  sheet.setFrozenRows(1);
}

function buildTaskSheet_(sheet) {
  setHeader_(sheet, TASK_HEADER_DEFS);

  // タスク状況プルダウン(10値。§3.1)
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(TASK_STATUS_ORDER, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('H2:H').setDataValidation(validation);

  // 値に応じた行全体の色分け(条件付き書式。§3.1)
  const range = sheet.getRange('A2:R');
  const rules = TASK_STATUS_STYLES.map(function (style) {
    const builder = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$H2="' + style.status + '"')
      .setBackground(style.background)
      .setRanges([range]);
    if (style.fontColor) builder.setFontColor(style.fontColor);
    if (style.strikethrough) builder.setStrikethrough(true);
    return builder.build();
  });
  sheet.setConditionalFormatRules(rules);

  // 自動型変換の防止: A列(対応期日は自由書式のテキスト)と管理列K〜R
  // (タスクID・messageId・yyyy-MM-dd が日付・数値に化けるとサマリ表示や照合が壊れる)
  sheet.getRange('A2:A').setNumberFormat('@');
  sheet.getRange('K2:R').setNumberFormat('@');
  // 非表示管理列 K〜R(§3.1)
  sheet.hideColumns(COL.TASK.TASK_ID, COL.TASK.LAST - COL.TASK.TASK_ID + 1);
}

function buildLogSheet_(sheet) {
  setHeader_(sheet, LOG_HEADER_DEFS);
  // messageId等の自動型変換防止
  sheet.getRange('A2:K').setNumberFormat('@');
}

function buildMasterSheet_(sheet) {
  setHeader_(sheet, MASTER_HEADER_DEFS);
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList([STATUS.MASTER.ACTIVE, STATUS.MASTER.LEFT, STATUS.MASTER.INTERNAL], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('C2:C').setDataValidation(validation);
  sheet.getRange('A2:A').setNumberFormat('@');
}

function buildSettingsSheet_(sheet) {
  setHeader_(sheet, SETTINGS_HEADER_DEFS);
  const rows = SETTING_DEFAULTS.map(function (item) {
    return [item.key, item.value, item.note];
  });
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
}

function buildTemplateSheet_(sheet) {
  setHeader_(sheet, TEMPLATE_HEADER_DEFS);
}

function buildErrorLogSheet_(sheet) {
  setHeader_(sheet, ERROR_HEADER_DEFS);
}

/**
 * 「使い方」シート(先頭タブ)。はじめて開いた担当者向けの説明専用シートで、
 * プログラムからは読み書きしない。内容はA〜Cの3列で構成する。
 */
function buildGuideSheet_(sheet) {
  const rows = [];
  const marks = { headings: [], subheaders: [], notes: [], faq: [] };
  function push(a, b, c) { rows.push([a || '', b || '', c || '']); return rows.length; }
  function pushHeading(text) { marks.headings.push(push(text)); }
  function pushSubheader(a, b, c) { marks.subheaders.push(push(a, b, c)); }
  function pushNote(text) { marks.notes.push(push(text)); }

  const titleRow = push('LINEタスク管理の使い方');
  const ledeRow = push('はじめての方はこのシートからお読みください。お客様とのLINEのやり取りをAIが読み取り、対応が必要な依頼を「タスク一覧」シートへ自動で登録する仕組みです。');
  push();

  pushHeading('1. 全体の流れ');
  push('(1) お客様がLINEグループに投稿');
  push('(2) AIがメッセージの内容を読み取り');
  push('(3) 「タスク一覧」シートに自動で登録(5分ごと)');
  push('(4) 毎朝10時ごろ、社内LINEグループへサマリを通知');
  const calloutRow = push('皆さんにお願いする作業は「担当者名の記入」と「タスク状況(進捗)の更新」の2つだけです。');
  push();

  pushHeading('2. 各シートの役割');
  pushSubheader('シート', '役割', '使う人');
  push('タスク一覧', 'タスクの一覧。AIが登録し、人が状況を更新します', '全員(毎日)');
  push('顧客マスタ', 'LINEグループとサロン名の対応表。Bot参加時にグループ名が自動で入ります。表記を変えたい場合は上書きしてください', 'グループ追加時');
  push('設定・返信テンプレート', 'システムの動作調整と返信文例', '管理者のみ');
  push('メッセージログ・エラーログ', 'システムの記録(自動)。通常は開く必要はありません', 'システム用');
  push();

  pushHeading('3. タスク状況と行の色');
  pushSubheader('タスク状況', '意味');
  const statusStartRow = rows.length + 1;
  GUIDE_STATUS_MEANINGS.forEach(function (item) { push(item.status, item.meaning); });
  push();

  pushHeading('4. どの列を誰が書くか(タスク一覧)');
  pushSubheader('列', '記入する人');
  push('担当者名／納品データ', 'あなた(AIは書き込みません)');
  push('対応期日／タスク状況(進捗)', 'AIが初期値を入れ、以後はあなたが更新');
  push('議事録・添付資料', 'AIが資料の保存リンクを追記。あなたも自由に追記できます');
  push('店舗名／メッセージ種別／作業内容／タスク発生日／返信提案', 'AIが自動記入(編集不要)');
  pushNote('見出しの色が目印です: 緑=人が触る列、墨色=AIの列。各見出しにカーソルを載せると詳しい説明が表示されます。');
  push();

  pushHeading('5. よくある質問');
  marks.faq.push(push('Q. AIが関係ないメッセージをタスクにしてしまった',
    'A. 行は削除せず、タスク状況を「対象外」に変更してください(記録として残ります)。'));
  marks.faq.push(push('Q. 通知やタスクのサロン名が空欄・不自然になっている',
    'A. 通常はBot参加時にLINEのグループ名が自動で入ります。空欄や不自然な場合は「顧客マスタ」シートのB列を記入・修正してください(それ以降のタスクや通知に反映されます)。'));
  marks.faq.push(push('Q. タスク状況を変えたのに行の色が変わらない',
    'A. 手入力ではなくプルダウン(セル右の「▾」)から選んでください。'));
  marks.faq.push(push('Q. LINEの朝の通知はいつ届く？',
    'A. 毎朝10時台に1回届きます。通知の「タスク一覧を開く」ボタンを押すと、端末の標準ブラウザでこのファイルが開きます(初回はGoogleへのログインが必要な場合があります)。'));
  marks.faq.push(push('Q. 困ったときは',
    'A. システム管理者へ連絡してください。エラーは自動で管理者にも通知されています。'));

  // 値の一括投入と体裁
  sheet.getRange(1, 1, rows.length, 3).setValues(rows).setVerticalAlignment('middle');
  sheet.setHiddenGridlines(true);
  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 480);
  sheet.setColumnWidth(3, 150);

  // タイトル帯・リード文
  sheet.getRange(titleRow, 1, 1, 3).merge()
    .setBackground(HEADER_STYLE.AI_BG).setFontColor(HEADER_STYLE.AI_FONT)
    .setFontWeight('bold').setFontSize(13);
  sheet.setRowHeight(titleRow, 36);
  sheet.getRange(ledeRow, 1, 1, 3).merge().setWrap(true).setFontColor('#5f6368');
  sheet.setRowHeight(ledeRow, 40);

  // セクション見出し(太字+緑の下線)
  marks.headings.forEach(function (row) {
    sheet.getRange(row, 1, 1, 3)
      .setFontWeight('bold').setFontSize(11)
      .setBorder(null, null, true, null, null, null, HEADER_STYLE.HUMAN_BG,
        SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  });

  // 表の小見出し(太字+墨色の下罫線)
  marks.subheaders.forEach(function (row) {
    sheet.getRange(row, 1, 1, 3)
      .setFontWeight('bold').setFontColor('#5f6368')
      .setBorder(null, null, true, null, null, null, HEADER_STYLE.AI_BG,
        SpreadsheetApp.BorderStyle.SOLID);
  });

  // お願い事項の強調帯
  sheet.getRange(calloutRow, 1, 1, 3).merge()
    .setBackground(HEADER_STYLE.HUMAN_BG).setFontWeight('bold');

  // タスク状況の凡例: タスク一覧の条件付き書式と同じ色を静的に塗る
  GUIDE_STATUS_MEANINGS.forEach(function (item, i) {
    const cell = sheet.getRange(statusStartRow + i, 1);
    cell.setBorder(true, true, true, true, null, null, '#d7dbde', SpreadsheetApp.BorderStyle.SOLID);
    const style = findStatusStyle_(item.status);
    if (!style) return; // 未対応=既定の白
    cell.setBackground(style.background);
    if (style.fontColor) cell.setFontColor(style.fontColor);
    if (style.strikethrough) cell.setFontLine('line-through');
  });

  // 補足文(グレー)
  marks.notes.forEach(function (row) {
    sheet.getRange(row, 1, 1, 3).merge().setWrap(true).setFontColor('#5f6368');
  });

  // よくある質問: 質問は太字、回答はB:C結合+折り返し
  marks.faq.forEach(function (row) {
    sheet.getRange(row, 1).setFontWeight('bold').setWrap(true);
    sheet.getRange(row, 2, 1, 2).merge().setWrap(true);
  });
}

/** タスク状況名から行色スタイルを引く(未対応=既定の白はnull) */
function findStatusStyle_(status) {
  for (let i = 0; i < TASK_STATUS_STYLES.length; i++) {
    if (TASK_STATUS_STYLES[i].status === status) return TASK_STATUS_STYLES[i];
  }
  return null;
}

/**
 * トリガーを設置する(§2.4。GASエディタから手動実行)。
 * 対象2関数の既存トリガーのみ削除→再作成する(冪等)。他のトリガーには触れない。
 */
function installTriggers() {
  const targets = ['runAnalysisBatch', 'sendDailySummary'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (targets.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('runAnalysisBatch').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('sendDailySummary').timeBased().atHour(10).everyDays(1).create();
  console.log('トリガーを設置しました: runAnalysisBatch(5分おき) / sendDailySummary(毎日10〜11時枠)');
}

/**
 * 顧客マスタのサロン名が空欄の行へ、LINEのグループ名を一括記入する(GASエディタから手動実行)。
 * 記入済みの行・退出済みの行には触れない。取得失敗はログに出す(Botが参加中か確認)。
 */
function backfillSalonNames() {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.MASTER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    console.log('backfillSalonNames: 顧客マスタにデータがありません');
    return;
  }
  const values = sheet.getRange(2, 1, lastRow - 1, COL.MASTER.LAST).getValues();
  let filled = 0;
  values.forEach(function (row, i) {
    const groupId = String(row[COL.MASTER.GROUP_ID - 1] || '');
    const salonName = String(row[COL.MASTER.SALON - 1] || '');
    const state = String(row[COL.MASTER.STATE - 1] || '');
    if (!groupId || salonName !== '' || state === STATUS.MASTER.LEFT) return;
    const summary = fetchGroupSummary_(groupId);
    if (summary && summary.groupName) {
      sheet.getRange(i + 2, COL.MASTER.SALON).setValue(asCellText_(String(summary.groupName)));
      console.log('[OK] ' + groupId + ' → ' + summary.groupName);
      filled++;
    } else {
      console.log('[NG] ' + groupId + ' → グループ名を取得できません(Botが参加中か確認)');
    }
  });
  console.log('backfillSalonNames: ' + filled + '件記入しました');
}

/**
 * Bot自身のユーザーID(destination照合用。Uで始まる値)を公式API /v2/bot/info から
 * 取得し、スクリプトプロパティ LINE_BOT_USER_ID へ保存する(§8.1)。
 * 先に LINE_CHANNEL_ACCESS_TOKEN を登録してから、GASエディタで手動実行すること。
 */
function setupLineBotUserId() {
  const response = fetchWithRetry_(CONFIG.LINE_API_BASE + '/v2/bot/info', {
    headers: lineHeaders_()
  }, 1);
  if (response.getResponseCode() !== 200) {
    throw new Error('bot/info取得失敗(先に ' + CONFIG.PROP.LINE_TOKEN +
      ' を登録してください。HTTP ' + response.getResponseCode() + '): ' + response.getContentText());
  }
  const info = JSON.parse(response.getContentText());
  PropertiesService.getScriptProperties().setProperty(CONFIG.PROP.BOT_USER_ID, info.userId);
  console.log('LINE_BOT_USER_ID を保存しました: ' + info.userId +
    '(basicId: ' + info.basicId + ' / displayName: ' + info.displayName + ')');
  return info.userId;
}

/**
 * 設定漏れ検査(§8.4。GASエディタから手動実行)。
 * スクリプトプロパティ全件とシート構成を確認し、結果をログに出す。
 */
function checkConfiguration() {
  const required = [
    CONFIG.PROP.LINE_TOKEN,
    CONFIG.PROP.VERIFY_TOKEN,
    CONFIG.PROP.BOT_USER_ID,
    CONFIG.PROP.GEMINI_API_KEY,
    CONFIG.PROP.DROPBOX_APP_KEY,
    CONFIG.PROP.DROPBOX_APP_SECRET,
    CONFIG.PROP.DROPBOX_REFRESH_TOKEN,
    CONFIG.PROP.SPREADSHEET_ID,
    CONFIG.PROP.SUMMARY_GROUP_ID,
    CONFIG.PROP.ADMIN_GROUP_ID
  ];
  const props = PropertiesService.getScriptProperties();
  const missing = [];

  required.forEach(function (key) {
    const value = props.getProperty(key);
    console.log((value ? '[OK] ' : '[NG] ') + key + (value ? '' : ' が未設定'));
    if (!value) missing.push(key);
  });

  if (props.getProperty(CONFIG.PROP.VERIFY_TOKEN) && props.getProperty(CONFIG.PROP.VERIFY_TOKEN).length < 32) {
    console.log('[NG] ' + CONFIG.PROP.VERIFY_TOKEN + ' は32文字以上にすること');
    missing.push(CONFIG.PROP.VERIFY_TOKEN + '(長さ不足)');
  }

  if (props.getProperty(CONFIG.PROP.SPREADSHEET_ID)) {
    try {
      const ss = getSpreadsheet_();
      [SHEET.GUIDE, SHEET.TASK, SHEET.LOG, SHEET.MASTER, SHEET.SETTINGS, SHEET.TEMPLATE, SHEET.ERROR_LOG]
        .forEach(function (name) {
          const exists = !!ss.getSheetByName(name);
          console.log((exists ? '[OK] ' : '[NG] ') + 'シート「' + name + '」' + (exists ? '' : ' が存在しない(setupSpreadsheet()を実行)'));
          if (!exists) missing.push('シート:' + name);
        });
    } catch (e) {
      console.log('[NG] スプレッドシートを開けない: ' + e.message);
      missing.push('SPREADSHEET_ID(アクセス不可)');
    }
  }

  if (missing.length === 0) {
    console.log('checkConfiguration: 全項目OK');
  } else {
    console.log('checkConfiguration: 未設定 ' + missing.length + ' 件 → ' + missing.join(', '));
  }
  return missing;
}
