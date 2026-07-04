---
type: ADR
title: 文書管理にOKF準拠のdocs-as-code構成を採用する
description: プロジェクト文書をdocs/配下のOKFバンドルとして管理し、意思決定はADRで記録する。
tags: [adr, documentation]
timestamp: 2026-07-04T17:00:00+09:00
status: accepted
---

# 文書管理にOKF準拠のdocs-as-code構成を採用する

## ステータス

accepted（2026-07-04）

## コンテキスト

sidepostはこれから育てていくプロジェクトであり、要件定義書に続いて設計文書・意思決定記録が増えていく。文書の置き場所と書式を最初に決めておかないと、リポジトリ直下に文書が散乱し、人間にもAIエージェントにも探しにくくなる。

また、開発の多くをAIエージェント（Claude Code等）と協働で進めるため、機械可読なメタデータを持つ文書形式が望ましい。

## 決定

1. すべてのプロジェクト文書を `docs/` 配下に置き、コードと同じリポジトリ・同じレビュープロセスで管理する（docs-as-code）。
2. `docs/` を [OKF (Open Knowledge Format) v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) バンドルとして構成する。各文書はYAMLフロントマター（`type` 必須）付きMarkdownとし、各ディレクトリに `index.md`（目次）、バンドルルートに `log.md`（変更履歴）を置く。
3. 文書は用途別に `requirements/`（要件）、`design/`（設計）、`adr/`（意思決定）、`guides/`（手順・ルール）に分類する。
4. アーキテクチャ上の重要な決定は ADR として `docs/adr/` に連番で記録する。

## 検討した代替案

- **リポジトリ直下にMarkdownを平置き** — 文書が少ないうちは十分だが、増えると分類・発見が困難になる。却下。
- **Notion・Google Docs等の外部ツール** — コードと文書のバージョンが分離し、PRレビューの対象外になる。AIエージェントからの参照も難しい。却下。
- **Diátaxis準拠の分類（tutorials / how-to / reference / explanation）** — 利用者向けドキュメントの分類として優れるが、現段階の文書は開発者向けの要件・設計・意思決定が中心でありスコープが合わない。将来、利用者向けドキュメントが必要になった時点で `docs/` 配下への追加を再検討する。

## 結果

- 文書の置き場所が一意に決まり、コード変更と同じPRで文書を更新できる。
- フロントマターの `type` / `tags` により、AIエージェントが文書を種類で絞り込める。
- OKFの要求は「`type` フィールド1つ」と極小のため、書き手の負担はほぼ増えない。
- 制約として、予約ファイル名 `index.md` / `log.md` を通常文書に使えない。また文書追加・移動時に `index.md` と `log.md` の更新が必要になる。
