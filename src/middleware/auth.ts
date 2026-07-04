import type { MiddlewareHandler } from "hono";
import { getAppSession, readSessionCookie } from "../services/session.js";
import type { AppEnv } from "../types.js";

/**
 * 認証必須ルート用ミドルウェア（screens.md 1.、oauth-session.md 5.）。
 *
 * セッションCookieから有効なアプリセッションを解決し、コンテキストに `session` を載せる。
 * 未ログイン・期限切れの場合は `/`（ログイン画面）へリダイレクトする。
 * 後続フェーズの `/compose`・`/manage` はこのミドルウェアを前段に置く。
 */
export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const sessionId = readSessionCookie(c);
    const session = sessionId ? getAppSession(c.get("db"), sessionId) : undefined;
    if (!session) {
      return c.redirect("/", 302);
    }
    c.set("session", session);
    await next();
    return undefined;
  };
}
