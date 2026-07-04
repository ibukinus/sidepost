import type Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/index.js";
import {
  APP_SESSION_TTL_MS,
  clearSessionCookie,
  createAppSession,
  deleteAppSession,
  deleteAppSessionsByDid,
  deleteExpiredAppSessions,
  getAppSession,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "./session.js";

describe("session", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it("createAppSession は256bitのIDとCSRFシークレットを持つセッションを作る", () => {
    const s = createAppSession(db, "did:plc:abc");
    expect(s.did).toBe("did:plc:abc");
    // base64url(32 bytes) = 43 文字
    expect(s.sessionId.length).toBeGreaterThanOrEqual(43);
    expect(s.csrfSecret.length).toBeGreaterThanOrEqual(43);
    expect(s.expiresAt).toBeGreaterThan(Date.now());
  });

  it("有効期限は発行から14日", () => {
    const before = Date.now();
    const s = createAppSession(db, "did:plc:abc");
    expect(s.expiresAt - before).toBeGreaterThanOrEqual(APP_SESSION_TTL_MS - 1000);
    expect(s.expiresAt - before).toBeLessThanOrEqual(APP_SESSION_TTL_MS + 1000);
  });

  it("getAppSession は有効なセッションを返す", () => {
    const s = createAppSession(db, "did:plc:abc");
    const got = getAppSession(db, s.sessionId);
    expect(got).toEqual(s);
  });

  it("存在しないセッションは undefined", () => {
    expect(getAppSession(db, "nope")).toBeUndefined();
  });

  it("期限切れセッションは undefined を返し削除される", () => {
    const s = createAppSession(db, "did:plc:abc");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + APP_SESSION_TTL_MS + 1000);
    expect(getAppSession(db, s.sessionId)).toBeUndefined();
    const count = db.prepare("SELECT COUNT(*) AS n FROM app_session").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("deleteAppSession / deleteAppSessionsByDid が機能する", () => {
    const s1 = createAppSession(db, "did:plc:abc");
    const s2 = createAppSession(db, "did:plc:abc");
    deleteAppSession(db, s1.sessionId);
    expect(getAppSession(db, s1.sessionId)).toBeUndefined();
    expect(getAppSession(db, s2.sessionId)).toBeDefined();
    deleteAppSessionsByDid(db, "did:plc:abc");
    expect(getAppSession(db, s2.sessionId)).toBeUndefined();
  });

  it("deleteExpiredAppSessions は期限切れのみ削除する", () => {
    const fresh = createAppSession(db, "did:plc:fresh");
    db.prepare("UPDATE app_session SET expires_at = ? WHERE session_id != ?").run(
      Date.now() - 1000,
      fresh.sessionId,
    );
    createAppSession(db, "did:plc:old");
    db.prepare("UPDATE app_session SET expires_at = ? WHERE did = ?").run(
      Date.now() - 1000,
      "did:plc:old",
    );
    deleteExpiredAppSessions(db);
    expect(getAppSession(db, fresh.sessionId)).toBeDefined();
    const count = db.prepare("SELECT COUNT(*) AS n FROM app_session").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("setSessionCookie は HttpOnly; Secure; SameSite=Lax; Path=/ を付ける", async () => {
    const app = new Hono();
    app.get("/set", (c) => {
      setSessionCookie(c, {
        sessionId: "sid-123",
        did: "did:plc:abc",
        csrfSecret: "csrf",
        expiresAt: Date.now() + APP_SESSION_TTL_MS,
      });
      return c.text("ok");
    });
    const res = await app.request("/set");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=sid-123`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toMatch(/Expires=/);
  });

  it("clearSessionCookie は失効用のSet-Cookieを出す", async () => {
    const app = new Hono();
    app.get("/clear", (c) => {
      clearSessionCookie(c);
      return c.text("ok");
    });
    const res = await app.request("/clear");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });
});
