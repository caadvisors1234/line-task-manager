/**
 * masterRepo.gs — 顧客マスタ・設定・返信テンプレートの読み書き(§3.3〜§3.5)
 */

let settingsMemo_ = null;

/** グループIDからサロン情報を引き当てる。未登録ならnull */
function resolveSalonName_(groupId) {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.MASTER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, COL.MASTER.LAST).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][COL.MASTER.GROUP_ID - 1]) === groupId) {
      return {
        rowIndex: i + 2,
        salonName: String(values[i][COL.MASTER.SALON - 1] || ''),
        state: String(values[i][COL.MASTER.STATE - 1] || '')
      };
    }
  }
  return null;
}

/** 新規グループを顧客マスタへ自動追加する(joinイベント・join漏れ検知時。§3.3) */
function registerNewGroup_(groupId) {
  // サロン名の初期値としてLINEのグループ名を取得(取得失敗時は空欄のまま登録し、
  // 従来どおり日次サマリの「サロン名未設定」警告で拾う)。書き込みは新規登録時の
  // 1回のみで以後Botは再更新しないため、担当者の上書きが常に優先される
  const summary = fetchGroupSummary_(groupId);
  const groupName = (summary && summary.groupName) ? String(summary.groupName) : '';
  return withScriptLock_(function () {
    const existing = resolveSalonName_(groupId);
    if (existing) {
      // Botの再参加時は「退出」を「有効」に戻す(「社内」等の手動設定は変えない)
      if (existing.state === STATUS.MASTER.LEFT) {
        getSpreadsheet_().getSheetByName(SHEET.MASTER)
          .getRange(existing.rowIndex, COL.MASTER.STATE).setValue(STATUS.MASTER.ACTIVE);
        existing.state = STATUS.MASTER.ACTIVE;
      }
      return existing; // 同時実行での二重登録防止
    }
    const sheet = getSpreadsheet_().getSheetByName(SHEET.MASTER);
    // グループ名は外部入力のため asCellText_ で数式インジェクション・型変換を防止
    sheet.appendRow([groupId, asCellText_(groupName), STATUS.MASTER.ACTIVE, formatDateTime_(new Date()), '']);
    return { rowIndex: sheet.getLastRow(), salonName: groupName, state: STATUS.MASTER.ACTIVE };
  });
}

/** グループの状態を更新する(leaveイベントで「退出」等。§3.3) */
function updateGroupState_(groupId, state) {
  const entry = resolveSalonName_(groupId);
  if (!entry) return;
  getSpreadsheet_().getSheetByName(SHEET.MASTER)
    .getRange(entry.rowIndex, COL.MASTER.STATE).setValue(state);
}

/** サロン名未設定の有効グループ数(日次サマリの警告用。§3.3) */
function countUnnamedActiveGroups_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.MASTER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, COL.MASTER.LAST).getValues();
  return values.filter(function (row) {
    return String(row[COL.MASTER.STATE - 1]) === STATUS.MASTER.ACTIVE &&
      String(row[COL.MASTER.SALON - 1] || '') === '';
  }).length;
}

/**
 * 設定シートを読み、型変換済みの設定オブジェクトを返す(実行内メモ化。§3.4)。
 * 値が空・不正な場合は初期値にフォールバックする。
 */
function getSettings_() {
  if (settingsMemo_) return settingsMemo_;
  const sheet = getSpreadsheet_().getSheetByName(SHEET.SETTINGS);
  const lastRow = sheet.getLastRow();
  const raw = {};
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(function (row) {
      raw[String(row[0])] = row[1];
    });
  }
  const num = function (key, fallback) {
    const n = Number(raw[key]);
    return (raw[key] === '' || raw[key] === undefined || isNaN(n)) ? fallback : n;
  };
  settingsMemo_ = {
    internalUserIds: String(raw[SETTING_KEY.INTERNAL_USER_IDS] || '')
      .split(/[,、\s\n]+/).map(function (s) { return s.trim(); }).filter(Boolean),
    firstReplyTemplate: String(raw[SETTING_KEY.FIRST_REPLY_TEMPLATE] || ''),
    conversationWindow: num(SETTING_KEY.CONVERSATION_WINDOW, 10),
    batchGroupLimit: num(SETTING_KEY.BATCH_GROUP_LIMIT, 5),
    summaryMaxItems: num(SETTING_KEY.SUMMARY_MAX_ITEMS, 15),
    quotaWarnThreshold: num(SETTING_KEY.QUOTA_WARN_THRESHOLD, 4500),
    dueSoonDays: num(SETTING_KEY.DUE_SOON_DAYS, 3)
  };
  return settingsMemo_;
}

/** 自社メンバーuserIDリスト(発言者区分の判定用。§3.4) */
function getInternalUserIds_() {
  return getSettings_().internalUserIds;
}

/** 返信テンプレート一覧(§3.5) */
function getReplyTemplates_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEET.TEMPLATE);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, COL.TEMPLATE.LAST).getValues()
    .filter(function (row) { return String(row[COL.TEMPLATE.NAME - 1] || '') !== ''; })
    .map(function (row) {
      return {
        name: String(row[COL.TEMPLATE.NAME - 1]),
        guide: String(row[COL.TEMPLATE.GUIDE - 1] || ''),
        body: String(row[COL.TEMPLATE.BODY - 1] || '')
      };
    });
}
