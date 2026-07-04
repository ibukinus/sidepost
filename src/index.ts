import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config/index.js";
import { openDatabase } from "./db/index.js";
import { createOAuthClient } from "./services/oauth.js";
import { deleteExpiredStates } from "./services/oauth-store.js";
import { deleteExpiredAppSessions } from "./services/session.js";

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const oauthClient = await createOAuthClient(config, db);
  const app = createApp({ config, db, oauthClient });

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
