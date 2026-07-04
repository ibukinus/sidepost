import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import type { Config } from "./config/index.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { homeRoute } from "./routes/home.js";
import { logoutRoute } from "./routes/logout.js";
import { oauthRoute } from "./routes/oauth.js";
import type { AppEnv } from "./types.js";
import { Layout } from "./views/layout.js";

export interface CreateAppDeps {
  config: Config;
  db: Database.Database;
  oauthClient: NodeOAuthClient;
}

export function createApp({ config, db, oauthClient }: CreateAppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("config", config);
    c.set("db", db);
    c.set("oauthClient", oauthClient);
    await next();
  });

  app.use("*", securityHeaders());

  app.use(
    "*",
    jsxRenderer(({ children, title }) => <Layout title={title}>{children}</Layout>),
  );

  app.use("/assets/*", serveStatic({ root: "./public" }));

  app.route("/", homeRoute);
  app.route("/", oauthRoute);
  app.route("/", logoutRoute);

  return app;
}
