import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SpoilerResult } from "../services/content.js";
import type { DenylistService } from "../services/denylist.js";
import type { AppEnv } from "../types.js";
import { createContentApiRoutes } from "./content-api.js";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const RKEY = "3juf5s2xku2v";

const sampleResult: SpoilerResult = {
  text: "ネタバレ本文",
  createdAt: "2026-07-04T00:00:00.000Z",
  author: { did: DID, handle: "alice.example.com", displayName: "Alice" },
  announcementUrl: `https://bsky.app/profile/${DID}/post/3announcement`,
};

function denylistStub(denied = false): DenylistService {
  return {
    isDenied: vi.fn().mockReturnValue(denied),
    reload: vi.fn(),
    stop: vi.fn(),
  };
}

function buildApp(deps: {
  denylist?: DenylistService;
  getSpoiler?: () => Promise<SpoilerResult | null>;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route(
    "/api/p",
    createContentApiRoutes({
      denylist: deps.denylist ?? denylistStub(),
      content: { getSpoiler: deps.getSpoiler ?? (async () => sampleResult) },
    }),
  );
  return app;
}

function expectHeaders(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nosnippet, noarchive");
}

describe("content-api route", () => {
  it("成功時は200で本文とヘッダを返す", async () => {
    const app = buildApp({ getSpoiler: async () => sampleResult });
    const res = await app.request(`/api/p/${DID}/${RKEY}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sampleResult);
    expectHeaders(res);
  });

  it("不正なDID構文は404 unavailable", async () => {
    const app = buildApp({});
    const res = await app.request(`/api/p/did:key:z6Mk/${RKEY}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expectHeaders(res);
  });

  it("不正なrkey構文は404 unavailable", async () => {
    const app = buildApp({});
    const res = await app.request(`/api/p/${DID}/bad%20key`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("表示停止対象は404（レコード取得前に判定）", async () => {
    const getSpoiler = vi.fn(async () => sampleResult);
    const app = buildApp({ denylist: denylistStub(true), getSpoiler });
    const res = await app.request(`/api/p/${DID}/${RKEY}`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(getSpoiler).not.toHaveBeenCalled();
  });

  it("本文サービスがnullを返したら404", async () => {
    const app = buildApp({ getSpoiler: async () => null });
    const res = await app.request(`/api/p/${DID}/${RKEY}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("本文サービスが例外を投げても404（理由を漏らさない）", async () => {
    const app = buildApp({
      getSpoiler: async () => {
        throw new Error("boom");
      },
    });
    const res = await app.request(`/api/p/${DID}/${RKEY}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expectHeaders(res);
  });
});
