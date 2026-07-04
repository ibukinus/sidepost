import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { deleteOAuthSession } from "../services/oauth-store.js";
import { clearSessionCookie, deleteAppSessionsByDid } from "../services/session.js";
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
  // oauth_session はDID単位のため、同一DIDの他ブラウザのアプリセッションだけ残すと
  // 「認証済みなのに書き込み不能」の宙吊り状態になる。DIDの全アプリセッションを削除する。
  deleteOAuthSession(db, session.did);
  deleteAppSessionsByDid(db, session.did);
  clearSessionCookie(c);
  return c.redirect("/", 302);
});
