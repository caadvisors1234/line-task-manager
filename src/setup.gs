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

// ヘッダー見出しの塗り分け: 緑=人が記入・更新する列 / 墨色=AIが自動記入する列 /
// グレー=使わない列(進捗管理は既存のタスク管理シートへ一本化したため)
const HEADER_STYLE = {
  HUMAN_BG: '#d9f2e5',
  HUMAN_FONT: '#24292e',
  AI_BG: '#24292e',
  AI_FONT: '#ffffff',
  UNUSED_BG: '#eef0f3',
  UNUSED_FONT: '#7b879a'
};

// 各シートのヘッダー定義: { name: 見出し, human: 人が記入・更新する列, unused: 使わない列, note: セルメモ }
// タスク一覧(§3.1)。A〜Kは既存業務シートの列名を踏襲(J: 元の連絡文のみ追加)、L〜S(非表示管理列)は平易名
const TASK_HEADER_DEFS = [
  { name: '対応期日', unused: true,
    note: '【この列は使いません】進捗の管理は既存のタスク管理シートで行います。\n【内容】メッセージから読み取れた場合にAIが期日を記入しますが、更新は不要です。' },
  { name: '納品データ', unused: true,
    note: '【この列は使いません】進捗の管理は既存のタスク管理シートで行います。AIも書き込みません。' },
  { name: '担当者名', unused: true,
    note: '【この列は使いません】進捗の管理は既存のタスク管理シートで行います。AIも書き込みません。' },
  { name: '店舗名',
    note: '【記入する人】AIが自動記入します(顧客マスタから引き当て)。\n【内容】依頼元のサロン名。空欄の場合は顧客マスタのサロン名を記入してください。\n【例】サロンA様' },
  { name: 'メッセージ種別',
    note: '【記入する人】AIが自動記入します。\n【内容】新規依頼／回答・承認／質問・確認／資料送付 のいずれか。\n【例】新規依頼' },
  { name: '作業内容',
    note: '【記入する人】AIが自動記入します。\n【内容】依頼内容の1行まとめ。\n【例】ホットペッパー広告バナーの差し替え' },
  { name: '議事録・添付資料',
    note: '【記入する人】AIと担当者の両方。AIは受信した画像・ファイルの保存先リンクを追記します(既存の内容は消しません)。\n【内容】議事録や資料のリンク。\n【例】https://www.dropbox.com/...' },
  { name: 'タスク状況(進捗)', unused: true,
    note: '【この列は使いません】進捗の管理は既存のタスク管理シートで行います。\n【内容】登録時にAIが初期値(未対応または反映待ち)を入れ、その値で行に色が付きますが、更新は不要です。' },
  { name: 'タスク発生日',
    note: '【記入する人】AIが自動記入します。\n【内容】タスクの発生日と発生元。\n【例】7/14 LINE' },
  { name: '元の連絡文',
    note: '【記入する人】AIが自動記入します。\n【内容】タスクの元になったLINEメッセージの本文。複数のメッセージをまとめて登録した場合は改行区切りで全件入ります。画像・ファイルは「(画像を受信)」などの表記になります。' },
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
    note: '【記入する人】AIが自動記入します(システム用)。編集しないでください。\n【内容】AIが読み取った期限(yyyy-MM-dd)。朝の通知の[急ぎ](期限間近)の判定に使います。' }
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
 * 稼働中のスプレッドシートへ、説明の変更を反映する(GASエディタから手動実行)。
 * setupSpreadsheet() は既存シートをスキップするため、「使い方」シートの文面や
 * タスク一覧のヘッダー(色・メモ)を更新したときはこちらを実行する。
 * 「使い方」シートは説明専用(プログラムから読み書きしない)なので作り直す。
 * タスク一覧は1行目のヘッダーだけを再設定し、タスクのデータには触れない。
 * 前提: タスク一覧の列レイアウトが最新であること(未移行のシートに実行すると
 * ヘッダーと実データの列がずれる。先に migrateTaskSheetAddOriginalText() を実行する)。
 */
function refreshGuideAndHeaders() {
  const ss = getSpreadsheet_();
  const guide = ss.getSheetByName(SHEET.GUIDE);
  if (guide) ss.deleteSheet(guide);
  createSheetIfMissing_(ss, SHEET.GUIDE, buildGuideSheet_, 0);

  const task = ss.getSheetByName(SHEET.TASK);
  if (task) {
    setHeader_(task, TASK_HEADER_DEFS);
    console.log('シート「' + SHEET.TASK + '」のヘッダーを再設定');
  }
  console.log('refreshGuideAndHeaders 完了');
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
 * ヘッダー行を設定する。defs: [{ name, human, unused, note }]
 * 見出しは緑(人が記入・更新する列)・墨色(AIが自動記入する列)・グレー(使わない列)に塗り分け、
 * メモで「何が入るか・誰が書くか・記入例」を示す(列の見方は使い方シート)。
 */
function setHeader_(sheet, defs) {
  const range = sheet.getRange(1, 1, 1, defs.length);
  range.setValues([defs.map(function (d) { return d.name; })]);
  range.setFontWeight('bold');
  range.setBackgrounds([defs.map(function (d) {
    if (d.unused) return HEADER_STYLE.UNUSED_BG;
    return d.human ? HEADER_STYLE.HUMAN_BG : HEADER_STYLE.AI_BG;
  })]);
  range.setFontColors([defs.map(function (d) {
    if (d.unused) return HEADER_STYLE.UNUSED_FONT;
    return d.human ? HEADER_STYLE.HUMAN_FONT : HEADER_STYLE.AI_FONT;
  })]);
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
  sheet.setConditionalFormatRules(buildTaskStatusRules_(sheet.getRange('A2:S')));

  // 自動型変換の防止: A列(対応期日は自由書式のテキスト)と管理列L〜S
  // (タスクID・messageId・yyyy-MM-dd が日付・数値に化けるとサマリ表示や照合が壊れる)
  sheet.getRange('A2:A').setNumberFormat('@');
  sheet.getRange('L2:S').setNumberFormat('@');
  // 非表示管理列 L〜S(§3.1)
  sheet.hideColumns(COL.TASK.TASK_ID, COL.TASK.LAST - COL.TASK.TASK_ID + 1);
}

/** タスク状況→行全体の色の条件付き書式ルール一式を生成する(§3.1。移行処理と共用) */
function buildTaskStatusRules_(range) {
  return TASK_STATUS_STYLES.map(function (style) {
    const builder = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$H2="' + style.status + '"')
      .setBackground(style.background)
      .setRanges([range]);
    if (style.fontColor) builder.setFontColor(style.fontColor);
    if (style.strikethrough) builder.setStrikethrough(true);
    return builder.build();
  });
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
  const ledeRow = push('お客様LINEでいただいたご依頼の対応漏れをなくすための一覧です。AIが対応の必要な連絡を拾い出して自動で登録し、毎朝10時ごろ、新しく届いた連絡の一覧を社内LINEグループへ通知します。');
  push();

  pushHeading('1. 毎朝これだけやる');
  push('(1) 社内LINEグループに届く「新着連絡サマリ」を開く(平日の朝10時台に1回。土日・祝日・年末年始12/29〜1/3はお休み)');
  push('(2) 上から順に、全件が対応済みかを確かめる(担当は決めていません。全員が全件に目を通してください)');
  push('(3) 抜けていた連絡があれば、いつもどおり既存のタスク管理シートに起こして対応する');
  const calloutRow = push('このシートに書き込む必要はありません。進捗の管理は、これまでどおり既存のタスク管理シートで行ってください。');
  push();

  pushHeading('2. このシートの見方');
  pushSubheader('列', '内容');
  push('店舗名／タスク発生日', 'どのサロン様から、いつ届いた連絡か');
  push('メッセージ種別', '新規依頼／回答・承認／質問・確認／資料送付のいずれか(雑談・お礼はタスクになりません)');
  push('作業内容', 'AIが要約した依頼の内容(画像で届いた依頼は、画像の中身も読み取って反映されます)');
  push('元の連絡文', 'タスクの元になったLINEの本文。判断に迷ったらここを確認してください');
  push('議事録・添付資料', 'お客様から届いた画像・ファイルの保存先リンク(Dropbox)');
  push('返信提案', 'AIが作成した返信の下書き。そのまま送られることはありません。送信は必ず担当者が行ってください');
  pushNote('「対応期日」「納品データ」「担当者名」「タスク状況(進捗)」の4列は使いません(AIが入れた初期値のままで構いません)。タスク状況の初期値によって行に色が付くことがありますが、更新は不要です。');
  pushNote('このファイルの他のシート(顧客マスタ・設定・返信テンプレート・各種ログ)は管理者用です。開く必要はありません。');
  push();

  pushHeading('3. よくある質問');
  marks.faq.push(push('Q. お客様に自動で返信が送られることはある？',
    'A. ありません。記録用アカウントはグループ内で一切発言しません。「返信提案」はこのシート内の下書きで、送信はすべて担当者が行います。'));
  marks.faq.push(push('Q. お客様から連絡が来たのに、タスクに出てこない',
    'A. 反映まで通常5分、遅い場合で15分ほどかかります。また、雑談・お礼だけの発言、スタンプ、自社メンバーの発言、1対1のトークはタスクになりません。それでも出てこない場合は管理者へ連絡してください。'));
  marks.faq.push(push('Q. 関係のない連絡までタスクになっている',
    'A. そのままで構いません。このシートは見落としを確認するためのもので、消す必要はありません(取りこぼしを防ぐため、AIは迷ったら多めに拾う設定にしています)。'));
  marks.faq.push(push('Q. LINEの朝の通知はいつ届く？',
    'A. 平日の朝10時台に1回届きます(土日・祝日・年末年始12/29〜1/3はお休みです)。内容は前回の通知以降に届いた新しい連絡の一覧です(月曜は金曜10時以降の分)。通知の「タスク一覧を開く」ボタンを押すと、端末の標準ブラウザでこのファイルが開きます(初回はGoogleへのログインが必要な場合があります)。'));
  marks.faq.push(push('Q. 通知に「分析失敗◯件」「サロン名未設定のグループが◯件」と出た',
    'A. どちらも管理者へ連絡してください。「分析失敗」は一部の連絡をAIが読み取れなかったサインです(該当のやり取りはLINEのトーク履歴で確認できます)。'));
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
 * 運用中の「タスク一覧」シートへ「元の連絡文」列(J列)を挿入するワンタイム移行(§3.1)。
 * setupSpreadsheet() は既存シートに触れないため、既存シートへの列追加はこの関数で行う。
 * 適用済みなら何もしない(冪等)。列挿入後に中断した状態からの再実行では挿入を跳ばして続きを適用する。
 * 想定外のレイアウトなら例外で中断する(別シート・二重実行の防護)。
 * 実行手順: runAnalysisBatch・sendDailySummary の両トリガーを一時削除(列ズレ書き込み・列ズレ読みの防止)
 *   → clasp push → 本関数 → installTriggers() で復旧。
 */
function migrateTaskSheetAddOriginalText() {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.TASK);
  if (!sheet) throw new Error('タスク一覧シートが見つかりません');
  const headerJ = String(sheet.getRange(1, COL.TASK.ORIGINAL_TEXT).getValue());
  const headerK = String(sheet.getRange(1, COL.TASK.REPLY_DRAFT).getValue());
  if (headerJ === '元の連絡文') {
    console.log('migrateTaskSheetAddOriginalText: 適用済みのためスキップ');
    return;
  }
  if (headerJ === '返信提案') {
    sheet.insertColumnBefore(COL.TASK.ORIGINAL_TEXT);
  } else if (!(headerJ === '' && headerK === '返信提案')) {
    // J1が空でK1=返信提案なら「前回、列挿入後に中断した状態」なので挿入を跳ばして続きを適用する
    throw new Error('想定外のレイアウトのため中断します(J1=「' + headerJ + '」/ K1=「' + headerK + '」)');
  }
  setHeader_(sheet, TASK_HEADER_DEFS);

  // 条件付き書式: 自前のタスク状況ルールだけを除去し、新レンジ(A2:S)で再構築する。
  // 他のルールは保全しつつ、移行前と同じく自前ルールを先頭に置く(先頭優先のため優先関係を変えない)
  const ownFormulas = TASK_STATUS_STYLES.map(function (style) { return '=$H2="' + style.status + '"'; });
  const kept = sheet.getConditionalFormatRules().filter(function (rule) {
    const condition = rule.getBooleanCondition();
    if (!condition) return true;
    return !condition.getCriteriaValues().some(function (value) {
      return ownFormulas.indexOf(String(value)) !== -1;
    });
  });
  sheet.setConditionalFormatRules(buildTaskStatusRules_(sheet.getRange('A2:S')).concat(kept));

  // 書式・非表示列を現行仕様に再適用(列挿入でずれた分の正規化。buildTaskSheet_ と同一内容)
  sheet.getRange('A2:A').setNumberFormat('@');
  sheet.getRange('L2:S').setNumberFormat('@');
  sheet.hideColumns(COL.TASK.TASK_ID, COL.TASK.LAST - COL.TASK.TASK_ID + 1);
  console.log('migrateTaskSheetAddOriginalText: 「元の連絡文」列を追加しました');
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
