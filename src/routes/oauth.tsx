import { Hono } from "hono";
import { classifyLoginError, LOGIN_SCOPE } from "../services/oauth.js";
import { createAppSession, setSessionCookie } from "../services/session.js";
import type { AppEnv } from "../types.js";
import { Login } from "../views/login.js";

/**
 * OAuth関連エンドポイント（oauth-session.md、screens.md 1.）。
 *
 * - GET /oauth/client-metadata.json … クライアントメタデータ公開。
 * - GET /oauth/jwks.json … クライアント認証用公開鍵集合（秘密要素は含まない）。
 * - POST /oauth/login … ハンドル受領→PAR→認可URLへリダイレクト。
 * - GET /oauth/callback … ライブラリのcallback処理（state/sub/issuer検証）後、
 *   アプリセッション発行→/compose。
 *
 * フォールバック禁止（AGENTS.md）: granular scope 非対応・認可拒否は明確なエラー画面を表示し、
 * 広いスコープでの再試行はしない。
 */
export const oauthRoute = new Hono<AppEnv>();

oauthRoute.get("/oauth/client-metadata.json", (c) => {
  return c.json(c.get("oauthClient").clientMetadata);
});

oauthRoute.get("/oauth/jwks.json", (c) => {
  // 公開鍵のみ（`d` を含まない）。oauth-session.md 1.、4.。
  return c.json(c.get("oauthClient").jwks);
});

oauthRoute.post("/oauth/login", async (c) => {
  const body = await c.req.parseBody();
  const rawHandle = typeof body.handle === "string" ? body.handle.trim() : "";
  if (!rawHandle) {
    return c.render(<Login error="empty-handle" />, { title: "ログイン" });
  }

  try {
    const authorizationUrl = await c
      .get("oauthClient")
      .authorize(rawHandle, { scope: LOGIN_SCOPE });
    return c.redirect(authorizationUrl.toString(), 302);
  } catch (err) {
    const reason = classifyLoginError(err);
    return c.render(<Login error={reason} handle={rawHandle} />, { title: "ログイン" });
  }
});

oauthRoute.get("/oauth/callback", async (c) => {
  const params = new URL(c.req.url).searchParams;
  try {
    // state検証・sub一致・issuer検証はライブラリが内部で実施する（oauth-session.md 3.）。
    const { session } = await c.get("oauthClient").callback(params);
    const appSession = createAppSession(c.get("db"), session.did);
    setSessionCookie(c, appSession);
    return c.redirect("/compose", 302);
  } catch (err) {
    const reason = classifyLoginError(err);
    return c.render(<Login error={reason} />, { title: "ログイン" });
  }
});
