import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

/**
 * アプリセッション管理（oauth-session.md 5.、要件7.3）。
 *
 * - セッションIDは256bitのCSPRNG値（要件は128bit以上）。
 * - 有効期限は発行から14日固定（スライディング延長なし）。期限到来で再ログイン。
 * - Cookieは `HttpOnly; Secure; SameSite=Lax; Path=/`。ブラウザにはセッションIDのみ渡し、
 *   OAuthトークンは一切渡さない。
 * - CSRFシークレットをセッションごとに保持し、CSRFトークンの生成・検証に用いる。
 */

export const SESSION_COOKIE_NAME = "skyseal_session";
export const APP_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const SESSION_ID_BYTES = 32;
const CSRF_SECRET_BYTES = 32;

export interface AppSession {
  sessionId: string;
  did: string;
  csrfSecret: string;
  /** epoch ミリ秒 */
  expiresAt: number;
}

interface AppSessionRow {
  session_id: string;
  did: string;
  csrf_secret: string;
  expires_at: number;
}

export function createAppSession(db: Database.Database, did: string): AppSession {
  const sessionId = randomBytes(SESSION_ID_BYTES).toString("base64url");
  const csrfSecret = randomBytes(CSRF_SECRET_BYTES).toString("base64url");
  const now = Date.now();
  const expiresAt = now + APP_SESSION_TTL_MS;
  db.prepare(
    "INSERT INTO app_session (session_id, did, csrf_secret, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(sessionId, did, csrfSecret, expiresAt, now);
  return { sessionId, did, csrfSecret, expiresAt };
}

/** 有効なアプリセッションを返す。存在しない・期限切れなら undefined（期限切れは削除する）。 */
export function getAppSession(db: Database.Database, sessionId: string): AppSession | undefined {
  const row = db
    .prepare(
      "SELECT session_id, did, csrf_secret, expires_at FROM app_session WHERE session_id = ?",
    )
    .get(sessionId) as AppSessionRow | undefined;
  if (!row) {
    return undefined;
  }
  if (row.expires_at <= Date.now()) {
    deleteAppSession(db, sessionId);
    return undefined;
  }
  return {
    sessionId: row.session_id,
    did: row.did,
    csrfSecret: row.csrf_secret,
    expiresAt: row.expires_at,
  };
}

export function deleteAppSession(db: Database.Database, sessionId: string): void {
  db.prepare("DELETE FROM app_session WHERE session_id = ?").run(sessionId);
}

export function deleteAppSessionsByDid(db: Database.Database, did: string): void {
  db.prepare("DELETE FROM app_session WHERE did = ?").run(did);
}

/** 期限切れセッションを削除する（定期ジョブ用）。 */
export function deleteExpiredAppSessions(db: Database.Database): void {
  db.prepare("DELETE FROM app_session WHERE expires_at <= ?").run(Date.now());
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}

export function setSessionCookie(c: Context, session: AppSession): void {
  setCookie(c, SESSION_COOKIE_NAME, session.sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(session.expiresAt),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
}
