import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";
import { csrfProtection, generateCsrfToken } from "../middleware/csrf.js";
import type { RepoAgent, SpoilerListPage } from "../services/manage.js";
import { deleteSpoilerPost, listSpoilerPosts, toRepoAgent } from "../services/manage.js";
import { getAgentForDid, SessionRevokedError } from "../services/oauth.js";
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
 * 自己完結の `Hono<AppEnv>` サブアプリとしてexportする。統括者は
 * `app.route("/", manageRoute)` で配線すること（他ルートと同様、パスプレフィックスなし）。
 *
 * PDSアクセスは `getAgentForDid` で取得した `Agent` を {@link toRepoAgent} で
 * 適合させて使う。`deps.getAgent` はテスト用の差し替え口（本番は既定値のまま使う）。
 */

export interface ManageRoutesDeps {
  getAgent: (client: NodeOAuthClient, db: Database.Database, did: string) => Promise<RepoAgent>;
}

const defaultDeps: ManageRoutesDeps = {
  getAgent: async (client, db, did) => toRepoAgent(await getAgentForDid(client, db, did)),
};

export function createManageRoutes(deps: ManageRoutesDeps = defaultDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/manage", requireAuth(), async (c) => {
    const session = c.get("session");
    const cursorParam = c.req.query("cursor");

    let agent: RepoAgent;
    try {
      agent = await deps.getAgent(c.get("oauthClient"), c.get("db"), session.did);
    } catch (err) {
      if (err instanceof SessionRevokedError) {
        return c.redirect("/", 302);
      }
      throw err;
    }

    const csrfToken = generateCsrfToken(session.csrfSecret);
    try {
      const page = await listSpoilerPosts(agent, session.did, cursorParam);
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

    let agent: RepoAgent;
    try {
      agent = await deps.getAgent(c.get("oauthClient"), c.get("db"), session.did);
    } catch (err) {
      if (err instanceof SessionRevokedError) {
        return c.redirect("/", 302);
      }
      throw err;
    }

    // 常にセッションのDID（自分のリポジトリ）に対してのみ操作する。
    // フォームは rkey のみを受け取り、DIDはリクエストから受け付けない。
    const outcome = await deleteSpoilerPost(agent, {
      did: session.did,
      rkey,
      origin: c.get("config").origin,
    });

    if (outcome.ok) {
      return c.redirect("/manage/deleted", 303);
    }

    const csrfToken = generateCsrfToken(session.csrfSecret);
    const page = await listSpoilerPosts(agent, session.did).catch(
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
