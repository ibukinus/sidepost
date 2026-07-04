import type Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/index.js";
import { createAppSession, SESSION_COOKIE_NAME } from "../services/session.js";
import type { AppEnv } from "../types.js";
import { requireAuth } from "./auth.js";

describe("requireAuth", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      await next();
    });
    app.get("/protected", requireAuth(), (c) => {
      return c.text(`did=${c.get("session").did}`);
    });
    return app;
  }

  it("未ログインは / へリダイレクトする", async () => {
    const res = await buildApp().request("/protected");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("不正なセッションIDのCookieは / へリダイレクトする", async () => {
    const res = await buildApp().request("/protected", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=invalid` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("有効なセッションでは通過し session.did を参照できる", async () => {
    const session = createAppSession(db, "did:plc:abc");
    const res = await buildApp().request("/protected", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.sessionId}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("did=did:plc:abc");
  });
});
