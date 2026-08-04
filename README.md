# line-task-manager

お客様とのLINEでのやり取りにおける対応漏れを防止するための、タスク自動管理の仕組み(提案・実装)を管理するリポジトリです。

## 概要

お客様とのLINEグループに記録用アカウント(LINE公式アカウント)を追加し、受信したメッセージをAIで分類・タスク化して、毎朝(土日祝・年末年始を除く)社内に共有する仕組みを構築します。

- メッセージ収集: LINE Messaging API(Webhook)
- 処理基盤: Google Apps Script
- AI分類: Gemini API(gemini-3.1-flash-lite)
- タスク管理: Google スプレッドシート
- 通知: 社内LINEグループへの新着連絡サマリ配信(前回送信以降に到着した連絡の一覧。土日祝・年末年始12/29〜1/3はスキップ)

## 構成

| パス | 内容 |
|---|---|
| `docs/index.html` | 提案資料(GitHub Pages で公開・正本) |
| `docs/setup.html` | 構築手順書(実装者向け・GitHub Pages で公開) |
| `docs/manual.html` | 利用マニュアル(現場スタッフ向け・GitHub Pages で公開) |
| `documents/proposal.md` | 詳細な対策案・技術仕様(旧版。仕様が食い違う場合は `docs/index.html` が正) |
| `documents/implementation-plan.md` | 実装プラン(GAS構成・シート設計・セットアップ手順・テスト計画) |
| `src/` | Google Apps Script 実装(clasp 管理。`rootDir: "src"`。各ファイルの責務は implementation-plan.md §2.1 参照) |
| `tools/hpb-status-colors/` | 先方の既存タスクシートへ「タスク状況の色分け」(条件付き書式)だけを移植する単体スクリプト(Bot本体とは独立・コピペ納品用) |
| `tools/task-status-column/` | 先方の既存タスクシートへ「タスク状況」プルダウン列を新設し色分けする単体スクリプト(同上。列挿入を伴う点が上と異なる) |

## 開発(clasp)

```bash
npm install -g @google/clasp
clasp login                # 会社共用のGoogleアカウントで認証
clasp push                 # src/ をGASプロジェクトへ反映
```

`.clasp.json` は設定済み(`scriptId`・`rootDir: "src"`)。別のGASプロジェクトへ反映する場合のみ
`scriptId` を差し替える。`clasp push` が失敗する場合は [Apps Script API](https://script.google.com/home/usersettings) が ON か確認。

デプロイはデプロイIDを固定し「バージョンを管理」から新バージョンを発行する
(URLが変わるとLINE側のWebhook URL再設定が必要になるため)。
セットアップ手順の全体は `docs/setup.html` を参照。

## 公開ページ

提案資料などは GitHub Pages で公開しています。

- 提案資料: https://caadvisors1234.github.io/line-task-manager/
- 構築手順書: https://caadvisors1234.github.io/line-task-manager/setup.html
- 利用マニュアル(現場スタッフ向け): https://caadvisors1234.github.io/line-task-manager/manual.html

(Settings > Pages > Source: `main` ブランチ / `docs` フォルダ)

## 今後の予定

- 本番環境への移行(本番用アカウントでの構築・切替。手順は docs/setup.html)
- 連続稼働確認(documents/implementation-plan.md §9.3)を経て試験運用(パイロット5〜10店舗)へ移行し、段階的に拡大
