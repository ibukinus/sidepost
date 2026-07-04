---
type: Guide
title: 文書管理ルール
description: sidepostにおける文書の置き場所、書式（OKF）、更新手順を定める。
tags: [documentation, rules]
timestamp: 2026-07-04T17:00:00+09:00
---

# 文書管理ルール

## 置き場所

プロジェクト文書はすべて `docs/` 配下に置く。リポジトリ直下には文書を置かない（`README.md`・`AGENTS.md` を除く）。

AIエージェント向け指示は `AGENTS.md` を正とし、`CLAUDE.md` は `AGENTS.md` へのシンボリックリンクとする。

| ディレクトリ | 置くもの | 例 |
| --- | --- | --- |
| `docs/requirements/` | 要件定義書 | MVP要件、フェーズ2要件 |
| `docs/design/` | 設計文書 | Lexicon定義、アーキテクチャ、画面設計 |
| `docs/adr/` | 意思決定の記録（ADR） | 技術選定、方式変更 |
| `docs/guides/` | 手順・ルール | 開発環境構築、リリース手順 |

分類に迷う判断基準：「何を作るか」= requirements、「どう作るか」= design、「なぜそう決めたか」= adr、「どう作業するか」= guides。

## 書式（OKF v0.1準拠）

`docs/` は [OKF (Open Knowledge Format) v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) のバンドルである。

- 1文書 = 1 Markdownファイル。ファイルパス（拡張子を除く）がその文書のIDになる。
- ファイル名は英小文字のkebab-case（例：`session-management.md`）。本文は日本語でよい。
- `index.md` と `log.md` は予約名であり、通常の文書に使ってはならない。
- 各文書の先頭にYAMLフロントマターを付ける。**`type` のみ必須**、他は推奨。

```yaml
---
type: Requirements | Design | ADR | Guide   # 必須。文書の種類
title: 表示名                                 # 推奨
description: 1文の要約                        # 推奨
tags: [tag1, tag2]                           # 推奨
timestamp: 2026-07-04T17:00:00+09:00         # 推奨。最終更新日時（ISO 8601）
status: draft | accepted | superseded        # 任意。ADRと要件で使用
---
```

- 文書間リンクは相対パスで書く（例：`[MVP要件](../requirements/mvp.md)`）。GitHub上でそのまま辿れることを優先し、OKFが推奨するバンドルルート相対（`/requirements/mvp.md`）は使わない。

## ADRの書き方

- ファイル名：`NNNN-短い英語スラッグ.md`（例：`0002-use-hono-for-backend.md`）。連番は4桁・欠番を再利用しない。
- 見出し構成：ステータス / コンテキスト / 決定 / 検討した代替案 / 結果。
- 一度acceptedにしたADRは書き換えない。決定を覆すときは新しいADRを作り、古い方の `status` を `superseded` にして新ADRへリンクする。

## 更新手順

文書を追加・移動・大きく更新したら、同じコミットで次も更新する。

1. そのディレクトリの `index.md` に文書へのリンクを追加（または修正）する。
2. `docs/log.md` の先頭に日付見出しと変更内容を追記する（新しい日付が上）。
3. 文書フロントマターの `timestamp` を更新する。
