import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../config/index.js";
import type { AppEnv } from "../types.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.js";

const limiters: RateLimiter[] = [];

afterEach(() => {
  for (const l of limiters.splice(0)) {
    l.stop();
  }
});

function buildApp(limiter: RateLimiter, trustedProxies: string[] = []): Hono<AppEnv> {
  limiters.push(limiter);
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("config", { trustedProxies } as unknown as Config);
    await next();
  });
  app.use("*", limiter.middleware);
  app.get("/x", (c) => c.text("ok"));
  return app;
}

function req(ip: string, xff?: string): Request {
  const headers: Record<string, string> = { "x-test-ip": ip };
  if (xff) {
    headers["x-forwarded-for"] = xff;
  }
  return new Request("http://localhost/x", { headers });
}

describe("createRateLimiter", () => {
  it("クライアントIPごとの上限を超えると429とRetry-Afterを返す", async () => {
    const clock = 0;
    const limiter = createRateLimiter({
      perIpCapacity: 2,
      globalCapacity: 100,
      windowMs: 60_000,
      now: () => clock,
      getRemoteAddress: (c) => c.req.header("x-test-ip"),
    });
    const app = buildApp(limiter);

    expect((await app.request(req("1.1.1.1"))).status).toBe(200);
    expect((await app.request(req("1.1.1.1"))).status).toBe(200);
    const blocked = await app.request(req("1.1.1.1"));
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);

    // 別IPは独立して許可される。
    expect((await app.request(req("2.2.2.2"))).status).toBe(200);
  });

  it("時間経過でトークンが補充される", async () => {
    let clock = 0;
    const limiter = createRateLimiter({
      perIpCapacity: 1,
      globalCapacity: 100,
      windowMs: 60_000,
      now: () => clock,
      getRemoteAddress: (c) => c.req.header("x-test-ip"),
    });
    const app = buildApp(limiter);

    expect((await app.request(req("1.1.1.1"))).status).toBe(200);
    expect((await app.request(req("1.1.1.1"))).status).toBe(429);

    // 1トークン補充されるまで時間を進める（60秒で1トークン）。
    clock += 60_000;
    expect((await app.request(req("1.1.1.1"))).status).toBe(200);
  });

  it("全体上限を超えると別IPでも429になる", async () => {
    const clock = 0;
    const limiter = createRateLimiter({
      perIpCapacity: 100,
      globalCapacity: 2,
      windowMs: 60_000,
      now: () => clock,
      getRemoteAddress: (c) => c.req.header("x-test-ip"),
    });
    const app = buildApp(limiter);

    expect((await app.request(req("1.1.1.1"))).status).toBe(200);
    expect((await app.request(req("2.2.2.2"))).status).toBe(200);
    expect((await app.request(req("3.3.3.3"))).status).toBe(429);
  });

  it("信頼プロキシ経由ではX-Forwarded-Forのクライアントごとに制限する", async () => {
    const clock = 0;
    const limiter = createRateLimiter({
      perIpCapacity: 1,
      globalCapacity: 100,
      windowMs: 60_000,
      now: () => clock,
      getRemoteAddress: () => "10.0.0.1", // 信頼プロキシからの接続
    });
    const app = buildApp(limiter, ["10.0.0.0/8"]);

    // 異なるクライアントIP（XFF）は別扱い。
    expect((await app.request(req("ignored", "203.0.113.1"))).status).toBe(200);
    expect((await app.request(req("ignored", "203.0.113.2"))).status).toBe(200);
    // 同じクライアントIPは2回目で超過。
    expect((await app.request(req("ignored", "203.0.113.1"))).status).toBe(429);
  });

  it("既定の容量は30（クライアントIPごと）", async () => {
    const clock = 0;
    const limiter = createRateLimiter({
      now: () => clock,
      getRemoteAddress: (c) => c.req.header("x-test-ip"),
    });
    const app = buildApp(limiter);

    for (let i = 0; i < 30; i++) {
      expect((await app.request(req("9.9.9.9"))).status).toBe(200);
    }
    expect((await app.request(req("9.9.9.9"))).status).toBe(429);
  });
});
