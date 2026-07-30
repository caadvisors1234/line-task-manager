/**
 * setupTaskStatusColumn.gs — 既存タスクシート向け: 「タスク状況」列の新設+色分けスクリプト
 *
 * 先方運用中のタスク管理スプレッドシートに「タスク状況」プルダウン列を1列新設し、
 * その値をキーにした条件付き書式で行全体を色分けする単体スクリプト(Bot本体とは独立)。
 * 対象スプレッドシートの 拡張機能 > Apps Script に本ファイルを貼り付けて使う。
 *
 * tools/hpb-status-colors(既存列への色分け移植)との違いは「列の新設」を伴うこと。
 * 既存の「タスク状況（進捗）」列は時系列メモとしてそのまま残し、一切触れない。
 * セルの既存値・既存の条件付き書式ルールにも触れない。適用方法は同梱の README.md を参照。
 *
 * 関数・定数はすべて ts 接頭辞付き(万一 hpb-status-colors と同じ Apps Script
 * プロジェクトに貼られても衝突しないようにするため)。
 */

// ===== 設定(対象シートに合わせてここだけ調整する) =====
const TS_SETTINGS = {
  // 対象タブごとの設定。必要な分だけ追記する。
  //   sheetId:      対象タブのgid(シートURLの「gid=」の後ろの数値)。null ならタブ名で探す
  //   sheetName:    対象タブ名(sheetId が null のときに使用)
  //   newHeader:    新設する列の見出し(再実行時はこの見出しの列を再利用する=冪等判定キー)
  //   anchorHeader: この見出しの列の「直後」に新設列を挿入する(実セルの値をコピーして貼ること)
  //   headerRow:    見出しの行(通常 1)
  //   firstDataRow: データの開始行(1行目が見出しなら 2)
  //   lastColumnLetter: 色を塗る範囲の右端の列レター。'' なら最終列を自動判定
  TARGETS: [
    {
      sheetId: 777716634,
      sheetName: '',
      newHeader: 'タスク状況',
      anchorHeader: 'タスク状況（進捗）',
      headerRow: 1,
      firstDataRow: 2,
      lastColumnLetter: ''
    }
  ],

  // プルダウン(データ検証)の扱い:
  //   'none'         = 触らない(色分けだけ入れる)
  //   'missing-only' = 新設列にプルダウンが未設定の場合のみ設定する(既定)
  //   'force'        = 既存の設定があっても上書きする
  // 補足: setAllowInvalid(false) のため選択肢以外の値は入力拒否される。行まるごとの
  // コピペ運用で貼り付けが拒否される場合は tsApplyValidation_ 内の該当行を true に緩める
  VALIDATION_MODE: 'missing-only',

  // 状況の値と行の色(Bot本体 setup.gs TASK_STATUS_STYLES と同じ内容のコピー)。
  // fontColor省略時は黒。
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
  ],

  // 新設列の見出しセルに付けるメモ
  HEADER_NOTE: 'プルダウンから選ぶと行全体の色が変わります'
};

/**
 * メイン: TS_SETTINGS.TARGETS の各タブへ「タスク状況」列の新設+プルダウン+色分けを適用する。
 * 再実行しても既存の「タスク状況」列を再利用して自前ルールを張り直すだけ(冪等)。
 * 既存の条件付き書式・他列のプルダウン・セルの値には触れない。
 */
function setupTaskStatusColumn() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  TS_SETTINGS.TARGETS.forEach(function (target) {
    const sheet = tsResolveSheet_(ss, target);
    if (!sheet) return;
    const found = tsFindOrInsertStatusColumn_(sheet, target);
    if (!found) return;
    const colLetter = tsColumnToLetter_(found.column);
    const kept = tsRemoveOwnRules_(sheet, target, colLetter);
    const added = tsBuildStatusRules_(sheet, target, colLetter);
    sheet.setConditionalFormatRules(kept.concat(added));
    const validationNote = tsApplyValidation_(sheet, target, colLetter);
    console.log('[OK] ' + sheet.getName() + ': ' + found.note +
      ' / 既存ルール保全 ' + kept.length + '件 / 色ルール追加 ' + added.length +
      '件 / プルダウン: ' + validationNote);
  });
}

/**
 * やり直し用: 本スクリプトが追加した色ルール・プルダウン・見出しメモだけを除去する。
 * 挿入した列自体は削除しない(運用開始後のデータ保護。不要なら列を右クリック > 列を削除)。
 * 他の条件付き書式・他列のプルダウンには触れない。
 */
function removeTaskStatusFormatting() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  TS_SETTINGS.TARGETS.forEach(function (target) {
    const sheet = tsResolveSheet_(ss, target);
    if (!sheet) return;
    const column = tsFindHeaderColumns_(sheet, target, target.newHeader)[0];
    if (!column) {
      console.log('[NG] ' + sheet.getName() + ': 「' + target.newHeader +
        '」列が見つからないため何もしません(TS_SETTINGS.newHeader を確認)');
      return;
    }
    const colLetter = tsColumnToLetter_(column);
    const before = sheet.getConditionalFormatRules().length;
    const kept = tsRemoveOwnRules_(sheet, target, colLetter);
    sheet.setConditionalFormatRules(kept);
    sheet.getRange(colLetter + target.firstDataRow + ':' + colLetter).clearDataValidations();
    sheet.getRange(target.headerRow, column).clearNote();
    console.log('[OK] ' + sheet.getName() + ': 自前ルールを ' + (before - kept.length) +
      '件除去 / ' + colLetter + '列のプルダウンと見出しメモを除去(列自体は残しています)');
  });
}

/** 対象タブを特定する(sheetId=gid 優先、なければタブ名)。見つからなければタブ一覧をログして null */
function tsResolveSheet_(ss, target) {
  if (target.sheetId !== null && target.sheetId !== undefined && target.sheetId !== '') {
    const byId = ss.getSheets().filter(function (s) {
      return s.getSheetId() === Number(target.sheetId);
    })[0];
    if (byId) return byId;
  } else if (target.sheetName) {
    const byName = ss.getSheetByName(target.sheetName);
    if (byName) return byName;
  }
  console.log('[NG] 対象タブが見つかりません(sheetId=' + target.sheetId +
    ' / sheetName=' + target.sheetName + ')。このスプレッドシートのタブ一覧:');
  ss.getSheets().forEach(function (s) {
    console.log('  ・「' + s.getName() + '」 gid=' + s.getSheetId());
  });
  return null;
}

/**
 * 「タスク状況」列を見つける。なければ anchorHeader 列の直後に新設する。
 * 戻り値: { column: 列番号, note: ログ用の説明 }。anchorHeader も見つからなければ
 * 何もせず null(運用中シートに推測で列を挿入しない)。
 */
function tsFindOrInsertStatusColumn_(sheet, target) {
  const existing = tsFindHeaderColumns_(sheet, target, target.newHeader);
  if (existing.length > 0) {
    if (existing.length > 1) {
      console.log('[注意] ' + sheet.getName() + ': 見出し「' + target.newHeader +
        '」の列が複数あります。最初の列(' + tsColumnToLetter_(existing[0]) + ')を使います');
    }
    // 撤去→再適用でも見出しメモが復元されるよう、再利用パスでも設定する(冪等)
    sheet.getRange(target.headerRow, existing[0]).setNote(TS_SETTINGS.HEADER_NOTE);
    return {
      column: existing[0],
      note: '既存の「' + target.newHeader + '」列(' + tsColumnToLetter_(existing[0]) + ')を再利用'
    };
  }
  const anchors = tsFindHeaderColumns_(sheet, target, target.anchorHeader);
  if (anchors.length === 0) {
    console.log('[NG] ' + sheet.getName() + ': 見出し「' + target.anchorHeader +
      '」の列が見つからないため中断します(TS_SETTINGS.anchorHeader に実セルの値をコピーして貼ってください)');
    return null;
  }
  const anchorColumn = anchors[0];
  sheet.insertColumnAfter(anchorColumn);
  const newColumn = anchorColumn + 1;
  const newLetter = tsColumnToLetter_(newColumn);
  const headerCell = sheet.getRange(target.headerRow, newColumn);
  headerCell.setValue(target.newHeader);
  headerCell.setNote(TS_SETTINGS.HEADER_NOTE);
  // 挿入列はアンカー列の書式とともにデータ検証も継承し得るため、検証だけクリアする
  // (継承したままだと missing-only 判定が「既存設定あり」と誤検知してプルダウンが入らない。
  //  書式の継承は先方シートの見た目に馴染ませるため残す)
  sheet.getRange(newLetter + target.firstDataRow + ':' + newLetter).clearDataValidations();
  return {
    column: newColumn,
    note: '「' + target.newHeader + '」列を' + newLetter + '列に新設'
  };
}

/**
 * 見出し行から名前が一致する列番号の一覧を返す。
 * 照合は正規化(空白除去+全角括弧→半角)後の完全一致のみ。
 * 「タスク状況」は「タスク状況（進捗）」の前方部分文字列のため、部分一致は誤検出する(使用禁止)。
 */
function tsFindHeaderColumns_(sheet, target, name) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return [];
  const headers = sheet.getRange(target.headerRow, 1, 1, lastColumn).getValues()[0];
  const wanted = tsNormalizeHeader_(name);
  const hits = [];
  headers.forEach(function (value, index) {
    if (tsNormalizeHeader_(value) === wanted) hits.push(index + 1);
  });
  return hits;
}

/** 見出し照合用の正規化: 空白(改行含む)除去+全角括弧→半角(表記ゆれの吸収) */
function tsNormalizeHeader_(value) {
  return String(value || '').replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
}

/** 列番号→列レター(26超対応。例: 27→AA) */
function tsColumnToLetter_(column) {
  let letter = '';
  let n = column;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/** 行の状況値と一致判定する数式(例: =$I2="依頼中") */
function tsStatusFormula_(target, colLetter, status) {
  return '=$' + colLetter + target.firstDataRow + '="' + status + '"';
}

/**
 * 対象タブの条件付き書式から自前の色ルールを除いた一覧を返す(セットはしない)。
 * 自前ルールの識別は「現在の列位置から生成した数式との一致」で行う。列位置は毎回
 * 見出しから再発見するため、左側への列挿入で数式が自動シフトしても識別が破綻しない。
 */
function tsRemoveOwnRules_(sheet, target, colLetter) {
  const ownFormulas = {};
  TS_SETTINGS.STATUS_STYLES.forEach(function (style) {
    ownFormulas[tsStatusFormula_(target, colLetter, style.status)] = true;
  });
  return sheet.getConditionalFormatRules().filter(function (rule) {
    const condition = rule.getBooleanCondition();
    if (!condition) return true;
    return !condition.getCriteriaValues().some(function (value) {
      return ownFormulas[String(value)] === true;
    });
  });
}

/** 1タブ分の色ルール一式を生成する(行全体: A列〜右端列。Bot本体 setup.gs buildTaskStatusRules_ と同形) */
function tsBuildStatusRules_(sheet, target, colLetter) {
  const lastLetter = target.lastColumnLetter || tsColumnToLetter_(sheet.getLastColumn());
  const range = sheet.getRange('A' + target.firstDataRow + ':' + lastLetter);
  return TS_SETTINGS.STATUS_STYLES.map(function (style) {
    const builder = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(tsStatusFormula_(target, colLetter, style.status))
      .setBackground(style.background)
      .setRanges([range]);
    if (style.fontColor) builder.setFontColor(style.fontColor);
    if (style.strikethrough) builder.setStrikethrough(true);
    return builder.build();
  });
}

/** 設定に応じて新設列へプルダウンを設定する。実行内容の説明文字列を返す */
function tsApplyValidation_(sheet, target, colLetter) {
  if (TS_SETTINGS.VALIDATION_MODE === 'none') return '設定しない(none)';
  const columnRange = sheet.getRange(colLetter + target.firstDataRow + ':' + colLetter);
  if (TS_SETTINGS.VALIDATION_MODE === 'missing-only') {
    const existing = sheet.getRange(colLetter + target.firstDataRow).getDataValidation();
    if (existing) return '既存の設定があるためスキップ(missing-only)';
  }
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList(TS_SETTINGS.STATUS_ORDER, true)
    .setAllowInvalid(false) // 行コピペ運用で貼り付け拒否が問題になる場合は true に緩める
    .build();
  columnRange.setDataValidation(validation);
  return '設定した(' + TS_SETTINGS.VALIDATION_MODE + ')';
}
