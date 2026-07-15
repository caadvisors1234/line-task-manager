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
  // 従来どおり日次サマリの「サロン名未設定」警告で拾う)。書き込みは空欄のときのみで
  // 記入済みの値には触れないため、担当者の上書きが常に優先される
  const summary = fetchGroupSummary_(groupId);
  const groupName = (summary && summary.groupName) ? String(summary.groupName) : '';
  return withScriptLock_(function () {
    const sheet = getSpreadsheet_().getSheetByName(SHEET.MASTER);
    const existing = resolveSalonName_(groupId);
    if (existing) {
      // Botの再参加時は「退出」を「有効」に戻す(「社内」等の手動設定は変えない)
      if (existing.state === STATUS.MASTER.LEFT) {
        sheet.getRange(existing.rowIndex, COL.MASTER.STATE).setValue(STATUS.MASTER.ACTIVE);
        existing.state = STATUS.MASTER.ACTIVE;
      }
      // サロン名が空欄のままの既存行はグループ名で補記する(記入済みの値は上書きしない)
      if (!existing.salonName && groupName) {
        sheet.getRange(existing.rowIndex, COL.MASTER.SALON).setValue(asCellText_(groupName));
        existing.salonName = groupName;
      }
      return existing; // 同時実行での二重登録防止
    }
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

/**
 * 自社メンバーuserIDリストへuserIdを追記する(状態「社内」グループの発言者を自動登録。§3.4)。
 * 手動転記の手間をなくすためのもので、登録済みなら何もしない。追記したときのみtrueを返す。
 * 手動で削除されたIDも本人が社内グループで発言すると再追記されるため、退職者は
 * リストからの削除とあわせてLINEグループからも退出させる運用とする(設定シートの説明に記載)。
 */
function appendInternalUserId_(userId) {
  if (!userId) return false; // Webhookイベントのsource.userIdは欠落し得る
  if (getInternalUserIds_().indexOf(userId) !== -1) return false; // 登録済み(定常時はここで抜ける)
  return withScriptLock_(function () {
    // ロック内でシートを読み直して再チェックする(複数メンバーがほぼ同時に初発言した
    // 場合のread-modify-write競合でIDが消失するのを防ぐ)
    settingsMemo_ = null;
    if (getInternalUserIds_().indexOf(userId) !== -1) return false;
    const sheet = getSpreadsheet_().getSheetByName(SHEET.SETTINGS);
    const found = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
      .createTextFinder(SETTING_KEY.INTERNAL_USER_IDS).matchEntireCell(true).findNext();
    if (!found) {
      logError_('appendInternalUserId_',
        new Error('設定シートに「' + SETTING_KEY.INTERNAL_USER_IDS + '」の行が見つかりません'));
      return false;
    }
    // 既存値は生のまま残す(担当者が改行区切り等で手整形していても壊さない)
    const cell = sheet.getRange(found.getRow(), 2);
    const current = String(cell.getValue() || '');
    cell.setValue(asCellText_(current ? current + ',' + userId : userId));
    // ロック解放前に書き込みを確定させる(未反映のままロックが外れると、並行実行が
    // 追記前の値を読んで上書きし、先に追記したIDが消失する)
    SpreadsheetApp.flush();
    settingsMemo_ = null; // 同一実行内の後続処理が追記後の値を読めるようにする
    return true;
  });
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
