/**
 * config.gs — 全定数の単一情報源
 * シート名・列番号・ステータス値は documents/implementation-plan.md §3 と1:1で一致させること。
 * トップレベルにはリテラルのみを置く(GASはグローバルスコープを毎実行評価するため、
 * SpreadsheetApp / PropertiesService 等の呼び出しをここに書かない)。
 */

const CONFIG = {
  TIMEZONE: 'Asia/Tokyo',

  // 分析バッチの自己中断ガード(GASの6分制限対策。§4.3)
  BATCH_TIME_LIMIT_MS: 4.5 * 60 * 1000,
  // メッセージログの検索対象は末尾N行のみ(全行走査をしない。§3.6)
  LOG_SEARCH_TAIL_ROWS: 500,
  // 分析リトライ上限(到達で「エラー」+管理者通知。§4.3)
  MAX_ANALYSIS_RETRY: 5,
  // 関連メッセージのまとめ待機(§4.3)。依頼文の直後に画像が届くケースを同一バッチに寄せるため、
  // グループ内の最新メッセージがこの時間以内なら分析を次回バッチへ持ち越す
  ANALYSIS_COOLDOWN_MS: 90 * 1000,
  // 上記の持ち越しの上限(§4.3)。連投が続くグループが分析されないまま滞留するのを防ぐため、
  // グループ内の最古の未分析メッセージがこれを超えたらクールダウンを無視して分析する。
  // 判定はバッチ(5分おき)の中でしか走らないため、実際の起票は最大 10分+5分 ≒ 15分後になる
  ANALYSIS_MAX_DEFER_MS: 10 * 60 * 1000,
  // 重複排除キャッシュのTTL(秒) = CacheServiceの最大値6時間(§4.1)
  DEDUPE_CACHE_TTL_SEC: 21600,
  // 管理者通知の同一種別抑制TTL(秒) = 1時間(§4.6)
  ADMIN_NOTIFY_SUPPRESS_SEC: 3600,
  // doPost内のロック取得・シート追記の再試行回数(§4.1)
  DOPOST_MAX_RETRY: 3,
  // LockServiceの待機時間(ms)(§7-17)
  LOCK_TIMEOUT_MS: 30 * 1000,
  // 動画・音声の変換待ち(§4.2)
  TRANSCODING_WAIT_MS: 2000,
  TRANSCODING_MAX_RETRY: 3,
  // 変換待ちの遅延再取得を打ち切るまでの時間(これを超えたら未保存として管理者通知)
  TRANSCODING_MAX_AGE_HOURS: 24,
  // Flexメッセージ(bubble)のJSONサイズ上限30KBに対する安全マージン(§4.4)
  FLEX_SIZE_LIMIT_BYTES: 27 * 1024,

  // 分析時にGeminiへ渡す画像の上限(§4.3・§5.1)
  // 3枚×4MB×4/3(base64膨張)≒16MB で、inline_data使用時のリクエスト全体20MB上限に収める
  ANALYSIS_IMAGE_MAX_COUNT: 3,               // 1分析(1グループ)あたりの添付枚数上限
  ANALYSIS_IMAGE_MAX_BYTES: 4 * 1024 * 1024, // 1枚あたりの生データ上限

  GEMINI_MODEL: 'gemini-3.1-flash-lite',
  GEMINI_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/',
  LINE_API_BASE: 'https://api.line.me',
  LINE_DATA_API_BASE: 'https://api-data.line.me',
  DROPBOX_API_BASE: 'https://api.dropboxapi.com',
  DROPBOX_CONTENT_API_BASE: 'https://content.dropboxapi.com',
  DROPBOX_ROOT_FOLDER: '/LINEタスク管理',

  // スクリプトプロパティのキー名(§2.2)
  PROP: {
    LINE_TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
    VERIFY_TOKEN: 'WEBHOOK_VERIFY_TOKEN',
    BOT_USER_ID: 'LINE_BOT_USER_ID',
    GEMINI_API_KEY: 'GEMINI_API_KEY',
    DROPBOX_APP_KEY: 'DROPBOX_APP_KEY',
    DROPBOX_APP_SECRET: 'DROPBOX_APP_SECRET',
    DROPBOX_REFRESH_TOKEN: 'DROPBOX_REFRESH_TOKEN',
    SPREADSHEET_ID: 'SPREADSHEET_ID',
    SUMMARY_GROUP_ID: 'SUMMARY_GROUP_ID',
    ADMIN_GROUP_ID: 'ADMIN_GROUP_ID',
    TASK_ID_SEQ: 'TASK_ID_SEQ',
    ANALYSIS_LOCK_UNTIL: 'ANALYSIS_LOCK_UNTIL'
  }
};

const SHEET = {
  GUIDE: '使い方',
  TASK: 'タスク一覧',
  LOG: 'メッセージログ',
  MASTER: '顧客マスタ',
  SETTINGS: '設定',
  TEMPLATE: '返信テンプレート',
  ERROR_LOG: 'エラーログ'
};

// 列番号(1始まり、Range準拠)
const COL = {
  // タスク一覧(§3.1): A〜Jが表示列、K〜Rが非表示管理列
  TASK: {
    DUE_TEXT: 1,          // A: 対応期日(AI初期値のみ→担当者)
    DELIVERY: 2,          // B: 納品データ(Bot書き込み禁止)
    ASSIGNEE: 3,          // C: 担当者名(Bot書き込み禁止)
    SALON: 4,             // D: 店舗名
    MSG_TYPE: 5,          // E: メッセージ種別
    SUMMARY: 6,           // F: 作業内容
    ATTACHMENT: 7,        // G: 議事録・添付資料(AIは追記のみ)
    STATUS: 8,            // H: タスク状況(AI初期値のみ→担当者)
    CREATED_LABEL: 9,     // I: タスク発生日(例: 7/2 LINE)
    REPLY_DRAFT: 10,      // J: 返信提案
    TASK_ID: 11,          // K: タスクID(T-0001形式)
    GROUP_ID: 12,         // L: グループID
    URGENCY: 13,          // M: 緊急度(高・中・低)
    RELATED_TASK_ID: 14,  // N: 関連タスクID
    NEEDS_REVIEW: 15,     // O: 要確認フラグ
    SOURCE_MESSAGE_ID: 16,// P: 起票元messageId
    CREATED_AT: 17,       // Q: 起票日時
    DUE_DATE: 18,         // R: 期限(yyyy-MM-dd。サマリの期限間近判定用)
    LAST: 18
  },
  // メッセージログ(§3.2)
  LOG: {
    RECEIVED_AT: 1,       // A: 受信日時
    GROUP_ID: 2,          // B: グループID
    SALON: 3,             // C: サロン名
    SPEAKER_TYPE: 4,      // D: 発言者区分(自社/お客様)
    USER_ID: 5,           // E: 発言者userId
    DISPLAY_NAME: 6,      // F: 発言者表示名
    MSG_TYPE: 7,          // G: メッセージタイプ
    BODY: 8,              // H: 本文
    MESSAGE_ID: 9,        // I: messageId
    EVENT_ID: 10,         // J: webhookEventId
    DROPBOX_LINK: 11,     // K: Dropboxリンク
    ANALYSIS_STATUS: 12,  // L: 分析ステータス
    ANALYSIS_JSON: 13,    // M: 分析結果JSON
    TASK_ID: 14,          // N: 起票タスクID
    RETRY_COUNT: 15,      // O: 分析試行回数
    LAST: 15
  },
  // 顧客マスタ(§3.3)
  MASTER: {
    GROUP_ID: 1,          // A: グループID
    SALON: 2,             // B: サロン名(人が記入)
    STATE: 3,             // C: 状態(有効/退出/社内)
    JOINED_AT: 4,         // D: Bot参加日
    NOTE: 5,              // E: 備考
    LAST: 5
  },
  // 返信テンプレート(§3.5)
  TEMPLATE: {
    NAME: 1,              // A: パターン名
    GUIDE: 2,             // B: 適用の目安
    BODY: 3,              // C: テンプレート本文
    NOTE: 4,              // D: 備考
    LAST: 4
  },
  // エラーログ
  ERROR: {
    AT: 1,                // A: 発生日時
    CONTEXT: 2,           // B: コンテキスト(関数名等)
    MESSAGE: 3,           // C: エラーメッセージ
    STACK: 4,             // D: スタックトレース
    LAST: 4
  }
};

const STATUS = {
  // タスク状況(§3.1の9区分+承認済みの「対象外」)
  TASK: {
    TODO: '未対応',
    REQUESTED: '依頼中',
    DONE_UNCHECKED: '作業完了・未チェック',
    CHECKED: 'チェック完了・残りお客様連絡',
    COMPLETED: 'タスク完了済み',
    SATO: '佐藤さん提出',
    URGENT: '急ぎの対応',
    AWAITING_APPLY: '反映待ち',
    AWAITING_CUSTOMER: 'お客様連絡待ち',
    EXCLUDED: '対象外'
  },
  // 分析ステータス(§3.2 L列)
  ANALYSIS: {
    PENDING: '未分析',
    DONE: '分析済',
    SKIP: '分析対象外',
    ERROR: 'エラー'
  },
  // 顧客マスタの状態(§3.3 C列)
  MASTER: {
    ACTIVE: '有効',
    LEFT: '退出',
    INTERNAL: '社内'
  }
};

// タスク状況プルダウンの表示順(§3.1の表の順+対象外)
const TASK_STATUS_ORDER = [
  '未対応', '依頼中', '作業完了・未チェック', 'チェック完了・残りお客様連絡',
  'タスク完了済み', '佐藤さん提出', '急ぎの対応', '反映待ち', 'お客様連絡待ち', '対象外'
];

// メッセージ種別(§3.1 E列 / §5.3 enum)
const MSG_TYPE = {
  NEW: '新規依頼',
  APPROVAL: '回答・承認',
  QUESTION: '質問・確認',
  MATERIAL: '資料送付',
  CHAT: '雑談・お礼'
};

// 発言者区分(§3.2 D列)
const SPEAKER = {
  INTERNAL: '自社',
  CUSTOMER: 'お客様'
};

// 分析画像として扱う拡張子→MIME(§4.3。Geminiのinline_data対応形式のみ)
const ANALYSIS_IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif'
};

// 設定シートの項目名(§3.4。A列の文字列そのものがキー)
const SETTING_KEY = {
  INTERNAL_USER_IDS: '自社メンバーuserIDリスト',
  FIRST_REPLY_TEMPLATE: '一次受け定型文',
  CONVERSATION_WINDOW: '会話ウィンドウ件数',
  BATCH_GROUP_LIMIT: 'バッチ1回の処理グループ数上限',
  SUMMARY_MAX_ITEMS: 'サマリ各区分の最大表示件数',
  QUOTA_WARN_THRESHOLD: '通数警告のしきい値',
  DUE_SOON_DAYS: '期限間近の判定日数'
};

// 設定シートの初期値・説明(setupSpreadsheet()が投入。§3.4)
const SETTING_DEFAULTS = [
  { key: '自社メンバーuserIDリスト', value: '', note: 'カンマ区切り(発言者区分の判定に使用)。状態「社内」のグループで発言した人が自動で追記されます。退職者は手動で削除し、LINEグループからも退出させてください(グループに残っていると発言時に再追記されます)' },
  { key: '一次受け定型文', value: '', note: 'すぐに判断できない依頼への返信提案の下書きに使用' },
  { key: '会話ウィンドウ件数', value: 10, note: '分析時にGeminiへ渡す直近会話の件数' },
  { key: 'バッチ1回の処理グループ数上限', value: 5, note: '実行時間ガード' },
  { key: 'サマリ各区分の最大表示件数', value: 15, note: '5,000文字対策' },
  { key: '通数警告のしきい値', value: 4500, note: '月次通数がこれを超えたら管理者警告' },
  { key: '期限間近の判定日数', value: 3, note: '期限が本日からこの日数以内を「期限間近」として扱う' }
];
