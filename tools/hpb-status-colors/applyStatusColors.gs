/**
 * applyStatusColors.gs — 既存タスクシート向け: タスク状況の色分け移植スクリプト
 *
 * LINEタスク管理Botの「タスク状況を選ぶと行全体の色が変わる仕組み」を、
 * 既存の運用スプレッドシートへ組み込む単体スクリプト(Bot本体とは独立)。
 * 移植先スプレッドシートの 拡張機能 > Apps Script に本ファイルを貼り付けて使う。
 *
 * 仕組みは条件付き書式(+任意でプルダウン)のみ。セルの値には一切触れないため、
 * 大きなシートでも安全に実行できる。適用方法は同梱の README.md を参照。
 */

// ===== 設定(移植先のシートに合わせてここだけ調整する) =====
const SETTINGS = {
  // 対象タブごとの設定。必要な分だけ追記する。
  //   sheetName:    対象タブ名
  //   statusColumn: タスク状況が入っている列(列レター)
  //   firstDataRow: データの開始行(1行目が見出しなら 2)
  //   applyRange:   色を塗る範囲(例 'A2:R'。firstDataRow と開始行を揃えること)
  TARGETS: [
    { sheetName: 'シート1', statusColumn: 'H', firstDataRow: 2, applyRange: 'A2:R' }
  ],

  // プルダウン(データ検証)の扱い:
  //   'none'         = 触らない(色分けだけ入れる)
  //   'missing-only' = 状況列にプルダウンが未設定の場合のみ設定する(既定)
  //   'force'        = 既存の設定があっても上書きする
  VALIDATION_MODE: 'missing-only',

  // 状況の値と行の色(Bot本体 setup.gs TASK_STATUS_STYLES と同じ内容のコピー)。
  // 移植先の運用に合わせて値・色を調整してよい。fontColor省略時は黒。
  STATUS_STYLES: [
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
  ],

  // プルダウンの選択肢(表示順。Bot本体 config.gs TASK_STATUS_ORDER のコピー)
  STATUS_ORDER: [
    '未対応', '依頼中', '作業完了・未チェック', 'チェック完了・残りお客様連絡',
    'タスク完了済み', '佐藤さん提出', '急ぎの対応', '反映待ち', 'お客様連絡待ち', '対象外'
  ]
};

/**
 * メイン: SETTINGS.TARGETS の各タブへ色分け(+設定に応じてプルダウン)を適用する。
 * 再実行しても自前ルールを張り直すだけで重複しない(冪等)。既存の条件付き書式は保全する。
 */
function applyStatusColors() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  SETTINGS.TARGETS.forEach(function (target) {
    const sheet = ss.getSheetByName(target.sheetName);
    if (!sheet) {
      console.log('[NG] タブ「' + target.sheetName + '」が見つかりません(SETTINGS.TARGETS を確認)');
      return;
    }
    const kept = removeOwnRules_(sheet);
    const added = buildStatusRules_(sheet, target);
    sheet.setConditionalFormatRules(kept.concat(added));
    const validationNote = applyValidation_(sheet, target);
    console.log('[OK] ' + target.sheetName + ': 既存ルール保全 ' + kept.length + '件 / 色ルール追加 ' +
      added.length + '件 / プルダウン: ' + validationNote);
  });
}

/**
 * やり直し用: 本スクリプトが追加した色ルールだけを全対象タブから除去する。
 * 他の条件付き書式・プルダウンには触れない。
 */
function removeStatusColors() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  SETTINGS.TARGETS.forEach(function (target) {
    const sheet = ss.getSheetByName(target.sheetName);
    if (!sheet) return;
    const before = sheet.getConditionalFormatRules().length;
    const kept = removeOwnRules_(sheet);
    sheet.setConditionalFormatRules(kept);
    console.log('[OK] ' + target.sheetName + ': 自前ルールを ' + (before - kept.length) + '件除去');
  });
}

/** 対象タブの条件付き書式から自前の色ルールを除いた一覧を返す(セットはしない) */
function removeOwnRules_(sheet) {
  const ownFormulas = {};
  SETTINGS.TARGETS.forEach(function (target) {
    SETTINGS.STATUS_STYLES.forEach(function (style) {
      ownFormulas[statusFormula_(target, style.status)] = true;
    });
  });
  return sheet.getConditionalFormatRules().filter(function (rule) {
    const condition = rule.getBooleanCondition();
    if (!condition) return true;
    return !condition.getCriteriaValues().some(function (value) {
      return ownFormulas[String(value)] === true;
    });
  });
}

/** 1タブ分の色ルール一式を生成する(Bot本体 setup.gs buildTaskStatusRules_ と同形) */
function buildStatusRules_(sheet, target) {
  const range = sheet.getRange(target.applyRange);
  return SETTINGS.STATUS_STYLES.map(function (style) {
    const builder = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(statusFormula_(target, style.status))
      .setBackground(style.background)
      .setRanges([range]);
    if (style.fontColor) builder.setFontColor(style.fontColor);
    if (style.strikethrough) builder.setStrikethrough(true);
    return builder.build();
  });
}

/** 行の状況値と一致判定する数式(例: =$H2="依頼中") */
function statusFormula_(target, status) {
  return '=$' + target.statusColumn + target.firstDataRow + '="' + status + '"';
}

/** 設定に応じて状況列へプルダウンを設定する。実行内容の説明文字列を返す */
function applyValidation_(sheet, target) {
  if (SETTINGS.VALIDATION_MODE === 'none') return '設定しない(none)';
  const columnRange = sheet.getRange(target.statusColumn + target.firstDataRow + ':' + target.statusColumn);
  if (SETTINGS.VALIDATION_MODE === 'missing-only') {
    const existing = sheet.getRange(target.statusColumn + target.firstDataRow).getDataValidation();
    if (existing) return '既存の設定があるためスキップ(missing-only)';
  }
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(SETTINGS.STATUS_ORDER, true)
    .setAllowInvalid(false)
    .build();
  columnRange.setDataValidation(validation);
  return '設定した(' + SETTINGS.VALIDATION_MODE + ')';
}
