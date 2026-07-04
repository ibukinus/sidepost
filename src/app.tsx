import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import type { Config } from "./config/index.js";
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

  // /p/* と /api/p/* は同一インスタンスで合算レート制限する（content-api.md 5.）。
  app.use("/p/*", rateLimiter.middleware);
  app.use("/api/p/*", rateLimiter.middleware);

  app.use(
    "*",
    jsxRenderer(({ children, title }) => <Layout title={title}>{children}</Layout>),
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
