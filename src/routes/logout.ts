import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { deleteOAuthSession } from "../services/oauth-store.js";
import { clearSessionCookie, deleteAppSession } from "../services/session.js";
import type { AppEnv } from "../types.js";

/**
 * POST /logout（screens.md 1.、oauth-session.md 7.）。
 *
 * 1. 認可サーバーのトークン取り消し（revocation）をベストエフォートで呼ぶ。
 * 2. oauth_session・app_session の該当行を削除する。
 * 3. セッションCookieを失効させて `/` へリダイレクトする。
 *
 * requireAuth + CSRF 必須。
 */
export const logoutRoute = new Hono<AppEnv>();

logoutRoute.post("/logout", requireAuth(), csrfProtection(), async (c) => {
  const session = c.get("session");
  const db = c.get("db");
  const client = c.get("oauthClient");

  // revocation はベストエフォート。失敗してもログアウトは継続する（oauth-session.md 7.）。
  try {
    await client.revoke(session.did);
  } catch {
    // 取り消し失敗（ネットワーク・既に失効等）は無視する。
  }

  // revoke が成功すればライブラリがセッションストアから削除するが、失敗時に備えて明示削除する。
  deleteOAuthSession(db, session.did);
  deleteAppSession(db, session.sessionId);
  clearSessionCookie(c);
  return c.redirect("/", 302);
});
