# 変更履歴

## 2026-07-04

**Update** — サービス名を「sidepost」（仮称）から「skyseal」に変更（`adr/0003-rename-service-to-skyseal.md` を新設）。ドメインを `skyseal.mp0.jp`、独自レコードのNSIDを `jp.mp0.skyseal.post` に変更し、`requirements/mvp.md`（6.3）、`design/index.md`、`docs/index.md`、`AGENTS.md`、`guides/documentation-rules.md` の表記を更新。

**Update** — `requirements/mvp.md` の `status` を `accepted` に更新し、独自レコードのNSIDを本番ドメイン `app.mp0.jp` に基づき `jp.mp0.app.spoiler.post` として確定（6.3）。`design/index.md` の設計文書候補に本文取得API設計・技術スタック選定・granular scope調査を追記。

**Update** — `requirements/mvp.md` をレビュー結果に基づき改訂。運営者による表示停止（6.9）と利用規約・プライバシーポリシー（6.10）をMVPスコープへ追加、本文取得をサービスAPI経由に決定（`adr/0002-fetch-spoiler-via-service-api.md` を新設）、案内投稿への link facet・固定リンクカード要件（6.4）、OAuthのgranular scope必須化（6.1、暫定スコープへのフォールバックは行わない）、投稿失敗時の本文保持・404応答などのエラー系要件、受入基準13〜15を追記。

**Creation** — ドキュメントバンドルを新設。`requirements/mvp.md`（MVP要件定義書、リポジトリ直下の「要件定義書案.md」から移動）、`adr/0001-adopt-okf-docs-structure.md`、`guides/documentation-rules.md` を追加。
