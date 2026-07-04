import type { Context } from "hono";
import { Hono } from "hono";
import { isValidRecordKey, parseDid } from "../lib/atproto-syntax.js";
import type { DenylistService } from "../services/denylist.js";
import type { AppEnv } from "../types.js";
import { PostPage, PostUnavailablePage } from "../views/post-page.js";

/**
 * 投稿表示画面 `GET /p/{did}/{rkey}`（screens.md 3.4、要件6.6・6.7）。
 *
 * SSR初期HTMLには本文を含めない。ここではDID/rkeyの構文検証と表示停止判定のみを
 * サーバー側で行い、構文不正または表示停止対象なら理由を区別せず404の固定メッセージ
 * ページを返す。レコードそのものの取得・形式検証（本文取得APIのステップ3〜5）は
 * クライアントJS（src/client/post.ts）が `GET /api/p/{did}/{rkey}` を呼んで行う。
 *
 * 注記（設計文書との齟齬）: screens.md 3.4は「本文取得APIと同じ表示可否判定
 * （content-api.md 2. の1〜5）」をSSR時点でも行う設計だが、本実装ではPhase 3bの
 * 依存範囲がdenylistのみに限定されているため、レコード取得を伴う判定（DID解決・
 * PDSからの取得・形式検証）はSSRでは行わない。そのため、存在しない・削除済み・
 * 形式不正なレコードに対してはSSRが200を返し、クライアント側のAPI呼び出しが404を
 * 返した時点で同じ固定メッセージを表示する（本文が漏れることはない）。screens.md
 * 3.4はこの経路を「ページ表示後の競合時」の扱いとして触れているが、本実装では
 * 通常経路としてこの経路を通る点が設計文書とは異なる。詳細は実装報告を参照。
 */

function setPageHeaders(c: Context<AppEnv>): void {
  // 専用ページ共通ヘッダ（architecture.md 5.、要件6.7）。
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nosnippet, noarchive");
}

export function createPostPageRoute(denylist: DenylistService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:did/:rkey", (c) => {
    setPageHeaders(c);

    const parsed = parseDid(c.req.param("did"));
    const rkey = c.req.param("rkey");

    // 構文不正・表示停止対象は理由を区別せず404固定メッセージ（要件6.6、content-api.md 2.）。
    if (parsed === null || !isValidRecordKey(rkey) || denylist.isDenied(parsed.did, rkey)) {
      return c.html(<PostUnavailablePage />, 404);
    }

    return c.html(<PostPage did={parsed.did} rkey={rkey} />, 200);
  });

  return app;
}
