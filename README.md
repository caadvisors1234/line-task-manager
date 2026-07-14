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
| `docs/manual.html` | 利用マニュアル(現場スタッフ向け・GitHub Pages で公開) |
| `documents/proposal.md` | 詳細な対策案・技術仕様(旧版。仕様が食い違う場合は `docs/index.html` が正) |
| `documents/implementation-plan.md` | 実装プラン(GAS構成・シート設計・セットアップ手順・テスト計画) |
| `src/` | Google Apps Script 実装(clasp 管理。`rootDir: "src"`) |

## 開発(clasp)

```bash
npm install -g @google/clasp
clasp login                # 会社共用のGoogleアカウントで認証
# .clasp.json の scriptId に対象GASプロジェクトのIDを設定してから
clasp push                 # src/ をGASプロジェクトへ反映
```

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

- LINEチャネル・Dropboxアプリの結線と実グループでの結合テスト(documents/implementation-plan.md §8.5・§9.2)
- 連続稼働確認(§9.3)を経て試験運用(パイロット5〜10店舗)へ移行
