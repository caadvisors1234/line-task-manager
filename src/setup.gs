/**
 * setup.gs — 初期構築ワンタイム関数(§8.3・§8.4)
 * setupSpreadsheet() はシート単位で冪等(既存シートには一切触れない)。
 * 再生成したい場合は対象シートを手動削除してから再実行する。
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

/** 全シート・プルダウン・条件付き書式・非表示列を生成する(GASエディタから手動実行) */
function setupSpreadsheet() {
  const ss = getSpreadsheet_();
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

/** シートが存在しなければ作成してbuilderを適用、存在すれば完全スキップ */
function createSheetIfMissing_(ss, name, builder) {
  if (ss.getSheetByName(name)) {
    console.log('シート「' + name + '」は既存のためスキップ');
    return;
  }
  const sheet = ss.insertSheet(name);
  builder(sheet);
  console.log('シート「' + name + '」を作成');
}

function setHeader_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function buildTaskSheet_(sheet) {
  setHeader_(sheet, [
    '対応期日', '納品データ', '担当者名', '店舗名', 'メッセージ種別', '作業内容',
    '議事録・添付資料', 'タスク状況(進捗)', 'タスク発生日', '返信提案',
    'タスクID', 'グループID', '緊急度', '関連タスクID', '要確認',
    '起票元messageId', '起票日時', '期限'
  ]);

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
  setHeader_(sheet, [
    '受信日時', 'グループID', 'サロン名', '発言者区分', '発言者userId', '発言者表示名',
    'メッセージタイプ', '本文', 'messageId', 'webhookEventId', 'Dropboxリンク',
    '分析ステータス', '分析結果JSON', '起票タスクID', '分析試行回数'
  ]);
  // messageId等の自動型変換防止
  sheet.getRange('A2:K').setNumberFormat('@');
}

function buildMasterSheet_(sheet) {
  setHeader_(sheet, ['グループID', 'サロン名', '状態', 'Bot参加日', '備考']);
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList([STATUS.MASTER.ACTIVE, STATUS.MASTER.LEFT, STATUS.MASTER.INTERNAL], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('C2:C').setDataValidation(validation);
  sheet.getRange('A2:A').setNumberFormat('@');
}

function buildSettingsSheet_(sheet) {
  setHeader_(sheet, ['項目名', '値', '説明']);
  const rows = SETTING_DEFAULTS.map(function (item) {
    return [item.key, item.value, item.note];
  });
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
}

function buildTemplateSheet_(sheet) {
  setHeader_(sheet, ['パターン名', '適用の目安', 'テンプレート本文', '備考']);
}

function buildErrorLogSheet_(sheet) {
  setHeader_(sheet, ['発生日時', 'コンテキスト', 'エラーメッセージ', 'スタックトレース']);
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
  ScriptApp.newTrigger('sendDailySummary').timeBased().atHour(9).everyDays(1).create();
  console.log('トリガーを設置しました: runAnalysisBatch(5分おき) / sendDailySummary(毎日9〜10時枠)');
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
      [SHEET.TASK, SHEET.LOG, SHEET.MASTER, SHEET.SETTINGS, SHEET.TEMPLATE, SHEET.ERROR_LOG]
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
