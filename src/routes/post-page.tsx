import type { Context } from "hono";
import { Hono } from "hono";
import { isValidRecordKey, parseDid } from "../lib/atproto-syntax.js";
import type { ContentService } from "../services/content.js";
import type { DenylistService } from "../services/denylist.js";
import type { AppEnv } from "../types.js";
import { PostPage, PostUnavailablePage } from "../views/post-page.js";

/**
 * 投稿表示画面 `GET /p/{did}/{rkey}`（screens.md 3.4、要件6.6・6.7）。
 *
 * SSR初期HTMLには本文を含めない。サーバーはまず本文取得APIと同じ表示可否判定
 * （content-api.md 2. のステップ1〜5。ContentServiceの実装を共有する）を行い、
 * 表示できない場合は理由を区別せずHTTP 404の固定メッセージページを返す（受入基準9）。
 * 判定中に取得した本文はレスポンスに含めず破棄する（本文はリクエスト処理中のみ保持。
 * 要件7.2。ログにも出力しない）。
 *
 * 表示できる場合は200で固定要素のみのプレースホルダHTMLを返し、クライアントJS
 * （src/client/post.ts）が `GET /api/p/{did}/{rkey}` を呼んで本文を描画する。
 * 1回の閲覧でPDSへのレコード取得が2回（SSR判定時とAPI呼び出し時）発生するが、
 * 要件6.6の404応答を満たすためのコストとして許容する（screens.md 3.4に明記）。
 */

export interface PostPageDeps {
  denylist: DenylistService;
  content: ContentService;
}

function setPageHeaders(c: Context<AppEnv>): void {
  // 専用ページ共通ヘッダ（architecture.md 5.、要件6.7）。
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nosnippet, noarchive");
}

export function createPostPageRoute(deps: PostPageDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:did/:rkey", async (c) => {
    setPageHeaders(c);

    const parsed = parseDid(c.req.param("did"));
    const rkey = c.req.param("rkey");

    // 入力検証・表示停止判定（content-api.md 2. ステップ1〜2）。
    // 不正・停止中は理由を区別せず404固定メッセージ（要件6.6）。
    if (parsed === null || !isValidRecordKey(rkey) || deps.denylist.isDenied(parsed.did, rkey)) {
      return c.html(<PostUnavailablePage />, 404);
    }

    // DID解決→レコード取得→形式検証（content-api.md 2. ステップ3〜5）。
    // 本文取得APIと同じ実装（ContentService）を共有する。取得した本文は初期HTMLに
    // 含めず、この場で破棄する（screens.md 3.4）。
    try {
      const result = await deps.content.getSpoiler(parsed, rkey);
      if (result === null) {
        return c.html(<PostUnavailablePage />, 404);
      }
    } catch {
      // 内部エラーも理由を区別せず404（本文・例外の生値はログに出さない）。
      return c.html(<PostUnavailablePage />, 404);
    }

    return c.html(<PostPage did={parsed.did} rkey={rkey} />, 200);
  });

  return app;
}
