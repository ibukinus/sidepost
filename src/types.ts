import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import type Database from "better-sqlite3";
import type { Config } from "./config/index.js";
import type { AppSession } from "./services/session.js";

/**
 * Honoコンテキストに載せる共通の依存関係。
 * ルートモジュールは `Hono<AppEnv>` として定義し、`c.get("config")` / `c.get("db")`
 * で設定とDBハンドルにアクセスできる。
 *
 * - `oauthClient` は全リクエストで利用可能（app.tsx で設定）。
 * - `session` は認証ミドルウェア（requireAuth）を通過したルートでのみ設定される。
 *   未設定のルートで参照してはならない。
 */
export interface AppEnv {
  Variables: {
    config: Config;
    db: Database.Database;
    oauthClient: NodeOAuthClient;
    session: AppSession;
  };
}

// hono/jsx-rendererのContextRendererは宣言マージ対象のinterfaceである必要があり、
// type aliasにすると多重定義エラーになる。
declare module "hono" {
  interface ContextRenderer {
    // biome-ignore lint/style/useShorthandFunctionType: 宣言マージのためinterfaceのまま維持する
    (content: string | Promise<string>, props?: { title?: string }): Response | Promise<Response>;
  }
}
