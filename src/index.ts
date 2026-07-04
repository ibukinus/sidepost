import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config/index.js";
import { openDatabase } from "./db/index.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { createContentApi } from "./routes/content-api.js";
import { createDidResolver } from "./services/did.js";
import { createOAuthClient } from "./services/oauth.js";
import { deleteExpiredStates } from "./services/oauth-store.js";
import { createPdsReader } from "./services/pds-read.js";
import { deleteExpiredAppSessions } from "./services/session.js";

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const oauthClient = await createOAuthClient(config, db);
  // DID解決キャッシュを本文取得API（contentApi）とPDS読み取り（pdsReader）で共有する。
  const didResolver = createDidResolver();
  const contentApi = createContentApi(config, { didResolver });
  const pdsReader = createPdsReader({ didResolver });
  const rateLimiter = createRateLimiter();
  const app = createApp({ config, db, oauthClient, contentApi, rateLimiter, pdsReader });

  // 期限切れの一時state・アプリセッションを定期削除する（oauth-session.md 3.・5.）。
  const cleanupTimer = setInterval(() => {
    deleteExpiredStates(db);
    deleteExpiredAppSessions(db);
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`skyseal listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`起動に失敗しました（設定エラー）: ${err.message}`);
  } else {
    console.error("起動に失敗しました:", err);
  }
  process.exit(1);
});
