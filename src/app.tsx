import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { jsxRenderer, useRequestContext } from "hono/jsx-renderer";
import type { Config } from "./config/index.js";
import { generateCsrfToken } from "./middleware/csrf.js";
import type { RateLimiter } from "./middleware/rate-limit.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { createComposeRoutes } from "./routes/compose.js";
import type { ContentApi } from "./routes/content-api.js";
import { homeRoute } from "./routes/home.js";
import { legalRoute } from "./routes/legal.js";
import { logoutRoute } from "./routes/logout.js";
import { createManageRoutes } from "./routes/manage.js";
import { oauthRoute } from "./routes/oauth.js";
import { createPostPageRoute } from "./routes/post-page.js";
import type { PdsReader } from "./services/pds-read.js";
import type { AppEnv } from "./types.js";
import { Layout } from "./views/layout.js";

export interface CreateAppDeps {
  config: Config;
  db: Database.Database;
  oauthClient: NodeOAuthClient;
  contentApi: ContentApi;
  rateLimiter: RateLimiter;
  /** PDSからの認証なし読み取り。DID解決キャッシュを contentApi と共有する。 */
  pdsReader: PdsReader;
}

export function createApp({
  config,
  db,
  oauthClient,
  contentApi,
  rateLimiter,
  pdsReader,
}: CreateAppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("config", config);
    c.set("db", db);
    c.set("oauthClient", oauthClient);
    await next();
  });

  app.use("*", securityHeaders());

  // 全POSTのボディ上限。最大の正当なボディはcomposeの本文（7,500バイトの
  // URLエンコードで最大約23KB）+CSRF等のため、64KBで十分な余裕がある。
  // 未認証の /oauth/login を含め、検証前の巨大ボディのバッファリングを防ぐ。
  app.use("*", bodyLimit({ maxSize: 64 * 1024 }));

  // /p/* と /api/p/* は同一インスタンスで合算レート制限する（content-api.md 5.）。
  app.use("/p/*", rateLimiter.middleware);
  app.use("/api/p/*", rateLimiter.middleware);

  app.use(
    "*",
    jsxRenderer(({ children, title }) => {
      // requireAuth を通過したルートではセッションが載っているので、共通レイアウトに
      // ログアウトフォーム用のCSRFトークンを渡す（未ログイン画面では描画されない）。
      const c = useRequestContext<AppEnv>();
      const session = c.get("session") as AppEnv["Variables"]["session"] | undefined;
      const logoutCsrfToken = session ? generateCsrfToken(session.csrfSecret) : undefined;
      return (
        <Layout title={title} logoutCsrfToken={logoutCsrfToken}>
          {children}
        </Layout>
      );
    }),
  );

  app.use("/assets/*", serveStatic({ root: "./public" }));

  app.route("/", homeRoute);
  app.route("/", oauthRoute);
  app.route("/", logoutRoute);
  app.route("/", createComposeRoutes({ reader: pdsReader }));
  app.route("/", createManageRoutes({ reader: pdsReader }));
  app.route("/", legalRoute);
  app.route("/api/p", contentApi.routes);
  app.route(
    "/p",
    createPostPageRoute({ denylist: contentApi.denylist, content: contentApi.content }),
  );

  return app;
}
