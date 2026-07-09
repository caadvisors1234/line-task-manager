# line-task-manager

お客様とのLINEでのやり取りにおける対応漏れを防止するための、タスク自動管理の仕組み(提案・実装)を管理するリポジトリです。

## 概要

お客様とのLINEグループに記録用アカウント(LINE公式アカウント)を追加し、受信したメッセージをAIで分類・タスク化して、毎朝社内に共有する仕組みを構築します。

- メッセージ収集: LINE Messaging API(Webhook)
- 処理基盤: Google Apps Script
- AI分類: Gemini API(gemini-3.1-flash-lite)
- タスク管理: Google スプレッドシート
- 通知: 社内LINEグループへの日次サマリ配信

## 構成

| パス | 内容 |
|---|---|
| `docs/index.html` | 提案資料(GitHub Pages で公開・正本) |
| `docs/setup.html` | 構築手順書(実装者向け・GitHub Pages で公開) |
| `proposal.md` | 詳細な対策案・技術仕様 |
| `implementation-plan.md` | 実装プラン(GAS構成・シート設計・セットアップ手順・テスト計画) |

## 公開ページ

提案資料は GitHub Pages で公開しています。

https://caadvisors1234.github.io/line-task-manager/

(Settings > Pages > Source: `main` ブランチ / `docs` フォルダ)

## 今後の予定

- `src/` 配下に Google Apps Script の実装を追加予定
