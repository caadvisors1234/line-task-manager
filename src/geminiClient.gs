/**
 * geminiClient.gs — Gemini API呼び出し(structured output。§5)
 */

/**
 * 分析用システム指示(§5.2 プロンプトv3)。
 * 版数管理: v1(2026-07-10 初版) / v2(2026-07-14 画像マルチモーダル対応。ルール8・9を追加) /
 *   v3(2026-07-16 出力単位をメッセージごと→タスクごとに変更。ルール7を書き換え)。
 * 変更時はここに日付と理由を追記する(§5.4)。
 */
const ANALYSIS_SYSTEM_PROMPT = [
  'あなたは美容室集客支援会社のタスク管理アシスタントです。会社とお客様(サロン)の',
  'LINEグループの会話を読み、お客様のメッセージから会社側の対応が必要なタスクを',
  '抽出します。',
  '',
  '判定ルール:',
  '1. 会話は時系列で与えられます。各発言には「自社」「お客様」の区分があります。',
  '   自社の発言は判定対象ではなく、文脈として使います。',
  '2. 「ありがとうございます」等の短い返信でも、直前に自社が作業の実施や下書き',
  '   登録を予告している場合は「回答・承認(進行承認)」と判定し、次工程(反映作業',
  '   等)をタスク化します。単なる相づち・雑談・社交辞令はタスク化しません。',
  '3. 未完了タスク一覧を与えます。新しいメッセージが既存タスクへの回答・承認で',
  '   ある場合は relatedTaskId に該当タスクIDを設定します。該当IDは与えられた',
  '   一覧の中からのみ選び、確信が持てない場合は relatedTaskId を null にして',
  '   needsReview を true にします。',
  '4. 判定に迷う場合はタスク化する方に倒してください(取りこぼしの防止が最優先。',
  '   不要なタスクは人が除外します)。',
  '5. 期限・日付は本文の相対表現(「金曜までに」等)を、与えられた現在日時を基準に',
  '   yyyy-MM-dd に変換します。読み取れない場合は null。',
  '6. replyDraft には担当者がそのまま送信できる丁寧な日本語の返信案を書きます。',
  '   与えられた返信テンプレートに近い状況があればその文体・構成に従います。',
  '   内容の判断が必要ですぐに答えられない依頼の場合は、与えられた「一次受け',
  '   定型文」をそのまま設定します。',
  '7. 出力はタスクごとに1要素とします。1つの用件が複数のメッセージに分かれている場合',
  '   (「TOP画像を変えたい」という依頼文とその画像が続けて送られた等)は1要素にまとめ、',
  '   sourceMessageIds に該当するmsg_idをすべて列挙します。まとめるのは同一の用件だと',
  '   明確に読み取れる場合のみとし、迷う場合は分けてください(別の用件をまとめると',
  '   片方が失われるため。この点はルール4より優先します)。タスク化しないメッセージ',
  '   (雑談・お礼等)も needsTask を false にした要素として出力します。分析対象',
  '   メッセージIDはすべて、いずれか1要素の sourceMessageIds にちょうど1回ずつ',
  '   現れる必要があります。',
  '8. 会話行の末尾に「 — 添付の画像N」とある発言は、その画像データを',
  '   「添付の画像N (msg_id=...)」のラベル付きで本文の後に添付します。画像の中身',
  '   (バナー・クーポン・原稿・スクリーンショット・チラシ等)を読み取り、',
  '   summary・messageType・replyDraft に具体的に反映してください',
  '   (例: 「クーポン画像(20%OFF)の差し替え依頼」)。',
  '9. 「画像本体は未添付」とある画像・ファイルは中身を確認できません。本文と前後の',
  '   文脈のみで判定し、画像の内容を推測して断定的に書かないでください。'
].join('\n');

/**
 * responseSchema(§5.3 の定義そのまま)。
 * relatedTaskIdの候補限定はプロンプト(未完了タスク一覧)+コード側の実在照合で行い、
 * スキーマのenumでは行わない(§7-10。enumは無関係なメッセージまで候補値へ誘導し得るため)。
 */
function buildResponseSchema_() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        sourceMessageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'このタスクの根拠となる分析対象メッセージのmsg_id(同一用件は複数まとめる)'
        },
        messageType: {
          type: 'string',
          enum: [MSG_TYPE.NEW, MSG_TYPE.APPROVAL, MSG_TYPE.QUESTION, MSG_TYPE.MATERIAL, MSG_TYPE.CHAT]
        },
        needsTask: { type: 'boolean' },
        summary: { type: 'string', description: '作業内容の1行サマリ' },
        urgency: { type: 'string', enum: ['高', '中', '低'] },
        dueDate: { type: 'string', nullable: true, description: 'yyyy-MM-dd' },
        relatedTaskId: { type: 'string', nullable: true },
        needsReview: { type: 'boolean' },
        isApproval: { type: 'boolean', description: '進行承認ならtrue(初期タスク状況を反映待ちにする)' },
        requesterName: { type: 'string' },
        replyDraft: { type: 'string', nullable: true }
      },
      required: ['sourceMessageIds', 'messageType', 'needsTask', 'summary', 'urgency', 'needsReview', 'isApproval']
    }
  };
}

/**
 * Gemini APIを呼び出し、パース済みJSONを返す(§5.1)。
 * extraParts(省略可): テキストの後ろに続けるparts配列(画像のinline_data等。§4.3)。
 * 失敗時は error.geminiErrorType を付けて投げる:
 *   'api'   — 429/5xx等のAPI失敗(呼び出し元は未分析のまま残して次回再試行)。
 *             error.httpStatus にHTTPコードを付加する(画像起因の400判定用)
 *   'parse' — スキーマ不一致・パース不能(呼び出し元は1回だけ再試行)
 */
function callGemini_(systemPrompt, userContent, responseSchema, extraParts) {
  const apiKey = getProp_(CONFIG.PROP.GEMINI_API_KEY);
  if (!apiKey) throw new Error(CONFIG.PROP.GEMINI_API_KEY + ' が未設定です');

  const url = CONFIG.GEMINI_ENDPOINT + CONFIG.GEMINI_MODEL + ':generateContent';
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userContent }].concat(extraParts || []) }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
      temperature: 0.2
    }
  };
  const response = fetchWithRetry_(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload)
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    const error = new Error('Gemini APIエラー(HTTP ' + code + '): ' + response.getContentText());
    error.geminiErrorType = 'api';
    error.httpStatus = code;
    throw error;
  }

  try {
    const body = JSON.parse(response.getContentText());
    const text = body.candidates[0].content.parts[0].text;
    return JSON.parse(text);
  } catch (e) {
    const error = new Error('Gemini応答のパースに失敗: ' + e.message);
    error.geminiErrorType = 'parse';
    throw error;
  }
}
