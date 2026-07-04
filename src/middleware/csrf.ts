import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";

/**
 * CSRF対策（oauth-session.md 6.、要件7.3）。
 *
 * `SameSite=Lax` Cookieに加え、セッションごとのCSRFシークレットから生成したトークンを
 * フォームに埋め込み、サーバー側で照合する二重防御。トークンは
 * `salt.HMAC-SHA256(csrfSecret, salt)` 形式で、リクエストごとにsaltを変える。
 *
 * POST /logout・POST /compose・POST /manage/delete で使用する。`requireAuth` の後段に置き、
 * `c.get("session")` の `csrfSecret` を用いる。
 */

export const CSRF_FIELD_NAME = "_csrf";

function computeMac(csrfSecret: string, salt: string): string {
  return createHmac("sha256", csrfSecret).update(salt).digest("hex");
}

export function generateCsrfToken(csrfSecret: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}.${computeMac(csrfSecret, salt)}`;
}

export function verifyCsrfToken(csrfSecret: string, token: string | undefined): boolean {
  if (!token) {
    return false;
  }
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return false;
  }
  const salt = token.slice(0, separator);
  const mac = token.slice(separator + 1);
  const expected = computeMac(csrfSecret, salt);
  const macBuf = Buffer.from(mac, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (macBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(macBuf, expectedBuf);
}

/**
 * フォームPOSTのCSRFトークンを検証するミドルウェア。`requireAuth` の後段に置くこと。
 * トークンはフォームフィールド `_csrf` から取得する。検証失敗時は403を返す。
 */
export function csrfProtection(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = c.get("session");
    const body = await c.req.parseBody();
    const raw = body[CSRF_FIELD_NAME];
    const token = typeof raw === "string" ? raw : undefined;
    if (!session || !verifyCsrfToken(session.csrfSecret, token)) {
      return c.text("CSRFトークンが無効です。", 403);
    }
    await next();
    return undefined;
  };
}
