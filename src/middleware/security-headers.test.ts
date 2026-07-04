import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers.js";

describe("securityHeaders", () => {
  it("全ページ共通のセキュリティヘッダを付与する", async () => {
    const app = new Hono();
    app.use("*", securityHeaders());
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");

    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
