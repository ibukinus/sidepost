---
type: ADR
title: サービス名をskysealとし、ドメイン・NSIDを確定する
description: サービス名をsidepost（仮称）からskysealに変更し、ドメインをskyseal.mp0.jp、NSID authorityをjp.mp0.skysealとする。
tags: [naming, domain, nsid, lexicon]
timestamp: 2026-07-04T21:37:00+09:00
status: accepted
---

# 0003 — サービス名をskysealとし、ドメイン・NSIDを確定する

## ステータス

accepted（2026-07-04）

## コンテキスト

これまでサービス名は仮称「sidepost」を用いており、ドメインは `app.mp0.jp`、独自レコードのNSIDは `jp.mp0.app.spoiler.post` としていた（[MVP要件定義書 6.3](../requirements/mvp.md)）。しかし「sidepost」は、本サービスの特徴である以下の2要素を表現していなかった。

- AT Protocol上のサービスであること
- ネタバレ回避（直接投稿しづらい内容を分離して読み書きする）サービスであること

ドメインは運営者が所持する `mp0.jp` のサブドメインを使う前提で、名称を再検討した。

前提として、[NSID仕様](https://atproto.com/specs/nsid)を確認し、`jp.mp0.*` がNSID authorityとして有効であることを確認した（数字で始められないのはTLDセグメントのみで、`mp0` は英字始まりのため問題ない）。

また、候補名について既存サービス・企業との衝突を調査した。「skyseal」を名乗る企業・製品は存在する（英国の天窓メーカー、建築用シーリング材、印刷会社、物流用セキュリティシール等）が、いずれもSNS・ソフトウェア・AT Protocol界隈とは分野が重ならず、混同のおそれは低いと判断した。

## 決定

| 項目 | 値 |
| --- | --- |
| サービス名 | **skyseal** |
| ドメイン | `skyseal.mp0.jp` |
| NSID authority | `jp.mp0.skyseal` |
| ネタバレ本文レコードのNSID | `jp.mp0.skyseal.post` |

命名の由来：

- **sky** — Bluesky／ATエコシステムのサービスであることを示す（Graysky、Skylightなどエコシステム内サードパーティの命名慣習に従う）。
- **seal** — 「封をした投稿を、読み手が自分の意思で開ける」というネタバレ分離の本質を表す。日本語の「シール」（貼って隠し、剥がして見る）のメタファーとも整合する。

## 検討した代替案

- **sidepost（現状維持）** — 仮称。要求した2要素をどちらも表現しないため不採用。
- **atobira**（AT + 扉） — 両要素を満たし読みも一意だが、意味が日本語話者にしか通じない。
- **atseal**（AT + seal） — 「アットシール／アトシール／エーティーシール」と読みが揺れ、口頭伝達・検索性でskysealに劣るため不採用。
- **atmaku・atveil・peekat・skyveil・tobari** — 読みの一意性、メタファーの分かりやすさ、ブランド展開のしやすさでskysealに劣ると判断。

## 結果

- ドメインを `app.mp0.jp` から `skyseal.mp0.jp` に変更し、独自レコードのNSIDを `jp.mp0.app.spoiler.post` から `jp.mp0.skyseal.post` に変更する。MVP要件定義書（6.3）と設計文書候補の表記を更新する。
- リポジトリ内の文書上のサービス名表記を「skyseal」に統一する（`AGENTS.md`、`docs/index.md` など）。
- 留意点：英Sky Groupは「Sky」を冠する名称への商標主張に積極的な歴史がある（Skype、SkyKickとの係争）。これは「sky」を含む名前全般に共通するリスクであり、日本国内の小規模サービスとしては実際上のリスクはごく低いと判断した。将来商標登録を検討する場合はJ-PlatPatで第9類・第42類の類似検索を行う。
