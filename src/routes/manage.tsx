import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";
import { csrfProtection, generateCsrfToken } from "../middleware/csrf.js";
import type { RepoWriter, SpoilerListPage } from "../services/manage.js";
import { deleteSpoilerPost, listSpoilerPosts, toRepoWriter } from "../services/manage.js";
import { getAgentForDid, SessionRevokedError } from "../services/oauth.js";
import type { PdsReader } from "../services/pds-read.js";
import { createPdsReader } from "../services/pds-read.js";
import type { AppEnv } from "../types.js";
import { ManageDeleted } from "../views/manage-deleted.js";
import { ManageList } from "../views/manage-list.js";

/**
 * 投稿管理・削除ルート（screens.md 1.、3.5、3.6、4.2）。
 *
 * - `GET /manage` … 自分の投稿一覧（requireAuth）。
 * - `POST /manage/delete` … 削除実行（requireAuth + CSRF）。成功時は303で
 *   `/manage/deleted` へ（PRG）。
 * - `GET /manage/deleted` … 削除完了画面（requireAuth）。
 *
 * 自己完結の `Hono<AppEnv>` サブアプリを返すファクトリ。統括者は
 * `app.route("/", ...)` で配線すること（他ルートと同様、パスプレフィックスなし）。
 *
 * 読み取り（一覧・削除前検証）は認証なしの {@link PdsReader} 経由で行う。
 * 書き込み（applyWrites）のみ `getAgentForDid` で取得した認証付き `Agent` を
 * {@link toRepoWriter} で適合させて使う（oauth-session.md 2.）。
 * `deps.reader`・`deps.getWriter` はテスト用の差し替え口（本番は既定値のまま使う）。
 */

export interface ManageRoutesDeps {
  /** 一覧・削除前検証の読み取り。未指定なら既定を生成する。 */
  reader?: PdsReader;
  /** 削除の書き込み用Agentの取得。未指定なら `getAgentForDid` 経由の既定を使う。 */
  getWriter?: (client: NodeOAuthClient, db: Database.Database, did: string) => Promise<RepoWriter>;
}

const defaultGetWriter: NonNullable<ManageRoutesDeps["getWriter"]> = async (client, db, did) =>
  toRepoWriter(await getAgentForDid(client, db, did));

export function createManageRoutes(deps: ManageRoutesDeps = {}): Hono<AppEnv> {
  const reader = deps.reader ?? createPdsReader();
  const getWriter = deps.getWriter ?? defaultGetWriter;
  const app = new Hono<AppEnv>();

  // 一覧に本文抜粋を含むため、共有・中間キャッシュへの残留を防ぐ（要件7.2の安全側運用）。
  app.use("/manage/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use("/manage", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/manage", requireAuth(), async (c) => {
    const session = c.get("session");
    const cursorParam = c.req.query("cursor");

    const csrfToken = generateCsrfToken(session.csrfSecret);
    try {
      const page = await listSpoilerPosts(reader, session.did, cursorParam);
      return c.render(
        <ManageList
          did={session.did}
          items={page.items}
          csrfToken={csrfToken}
          {...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {})}
        />,
        { title: "投稿管理" },
      );
    } catch {
      // PDS障害等。本文・PDSレスポンス生値はログに出さない（要件7.1）。
      return c.render(
        <ManageList did={session.did} items={[]} csrfToken={csrfToken} error="list-failed" />,
        { title: "投稿管理" },
      );
    }
  });

  app.post("/manage/delete", requireAuth(), csrfProtection(), async (c) => {
    const session = c.get("session");
    const body = await c.req.parseBody();
    const rkey = typeof body.rkey === "string" ? body.rkey : "";

    let writer: RepoWriter;
    try {
      writer = await getWriter(c.get("oauthClient"), c.get("db"), session.did);
    } catch (err) {
      if (err instanceof SessionRevokedError) {
        return c.redirect("/", 302);
      }
      throw err;
    }

    // 常にセッションのDID（自分のリポジトリ）に対してのみ操作する。
    // フォームは rkey のみを受け取り、DIDはリクエストから受け付けない。
    // 読み取りは reader（認証なし）、書き込みは writer（認証付き）で行う。
    const outcome = await deleteSpoilerPost(reader, writer, {
      did: session.did,
      rkey,
      origin: c.get("config").origin,
    });

    if (outcome.ok) {
      return c.redirect("/manage/deleted", 303);
    }

    const csrfToken = generateCsrfToken(session.csrfSecret);
    const page = await listSpoilerPosts(reader, session.did).catch(
      (): SpoilerListPage => ({ items: [] }),
    );
    return c.render(
      <ManageList
        did={session.did}
        items={page.items}
        csrfToken={csrfToken}
        error={outcome.reason}
        {...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {})}
      />,
      { title: "投稿管理" },
    );
  });

  app.get("/manage/deleted", requireAuth(), (c) => {
    return c.render(<ManageDeleted />, { title: "削除完了" });
  });

  return app;
}

export const manageRoute = createManageRoutes();
