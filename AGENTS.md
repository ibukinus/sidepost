# sidepost

Bluesky（AT Protocol）上でネタバレ本文を通常投稿から分離するサービス。ネタバレ本文は投稿者自身のPDSに独自レコードとして保存し、Blueskyには固定文言と専用URLのみを投稿する。

## ドキュメント

- プロジェクト文書はすべて `docs/`（OKF v0.1バンドル）にある。入口は `docs/index.md`。
- 要件は `docs/requirements/mvp.md`、意思決定は `docs/adr/`。
- 文書を追加・更新するときは `docs/guides/documentation-rules.md` のルールに従うこと（フロントマター必須、`index.md` と `docs/log.md` の同時更新）。
- アーキテクチャ上の重要な決定をしたら、ADRとして `docs/adr/` に記録すること。
