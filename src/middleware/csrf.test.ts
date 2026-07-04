import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../types.js";
import { CSRF_FIELD_NAME, csrfProtection, generateCsrfToken, verifyCsrfToken } from "./csrf.js";

describe("csrf token", () => {
  const secret = randomBytes(32).toString("base64url");

  it("生成したトークンは検証を通る", () => {
    const token = generateCsrfToken(secret);
    expect(verifyCsrfToken(secret, token)).toBe(true);
  });

  it("毎回異なるトークンになる（saltが変わる）", () => {
    expect(generateCsrfToken(secret)).not.toBe(generateCsrfToken(secret));
  });

  it("別シークレットでは検証に失敗する", () => {
    const token = generateCsrfToken(secret);
    expect(verifyCsrfToken(randomBytes(32).toString("base64url"), token)).toBe(false);
  });

  it("未定義・空・不正形式を拒否する", () => {
    expect(verifyCsrfToken(secret, undefined)).toBe(false);
    expect(verifyCsrfToken(secret, "")).toBe(false);
    expect(verifyCsrfToken(secret, "no-dot")).toBe(false);
    expect(verifyCsrfToken(secret, ".abc")).toBe(false);
    expect(verifyCsrfToken(secret, "abc.")).toBe(false);
  });

  it("MAC部分を改ざんすると失敗する", () => {
    const token = generateCsrfToken(secret);
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    expect(verifyCsrfToken(secret, tampered)).toBe(false);
  });
});

describe("csrfProtection middleware", () => {
  const secret = randomBytes(32).toString("base64url");

  function buildApp() {
    const app = new Hono<AppEnv>();
    app.use("/protected", async (c, next) => {
      c.set("session", {
        sessionId: "sid",
        did: "did:plc:abc",
        csrfSecret: secret,
        expiresAt: Date.now() + 1000,
      });
      await next();
    });
    app.post("/protected", csrfProtection(), (c) => c.text("done"));
    return app;
  }

  it("正しいトークンで通過する", async () => {
    const token = generateCsrfToken(secret);
    const body = new URLSearchParams({ [CSRF_FIELD_NAME]: token });
    const res = await buildApp().request("/protected", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("done");
  });

  it("トークン欠如・不正で403を返す", async () => {
    const res = await buildApp().request("/protected", {
      method: "POST",
      body: new URLSearchParams({ [CSRF_FIELD_NAME]: "bogus.token" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(403);
  });
});
