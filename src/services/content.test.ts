import { describe, expect, it, vi } from "vitest";
import type { ParsedDid } from "../lib/atproto-syntax.js";
import type { SafeFetchResult } from "../lib/safe-fetch.js";
import { createContentService, type FetchFn, validateSpoilerRecord } from "./content.js";
import type { DidResolver } from "./did.js";
import type { HandleResolver } from "./handle.js";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const PARSED: ParsedDid = { method: "plc", did: DID };
const PDS = "https://pds.example.com";

function jsonResult(body: unknown, status = 200): SafeFetchResult {
  return { status, headers: {}, body: Buffer.from(JSON.stringify(body), "utf8") };
}

const validRecord = {
  $type: "jp.mp0.skyseal.post",
  text: "ネタバレ本文",
  createdAt: "2026-07-04T00:00:00.000Z",
  announcementRkey: "3announcement",
};

interface FakeFetchOptions {
  spoiler?: SafeFetchResult | (() => Promise<SafeFetchResult>);
  profile?: SafeFetchResult | (() => Promise<SafeFetchResult>);
}

function fakeFetch(opts: FakeFetchOptions): FetchFn {
  return async (url: string) => {
    const target = url.includes("app.bsky.actor.profile") ? opts.profile : opts.spoiler;
    if (target === undefined) {
      return jsonResult({}, 404);
    }
    return typeof target === "function" ? target() : target;
  };
}

function didResolverStub(handleCandidate: string | null = "alice.example.com"): DidResolver {
  return { resolve: vi.fn().mockResolvedValue({ pdsUrl: PDS, handleCandidate }) };
}

function handleResolverStub(resolvedDid: string | null): HandleResolver {
  return { resolve: vi.fn().mockResolvedValue(resolvedDid) };
}

describe("createContentService.getSpoiler", () => {
  it("本文・投稿者情報・announcementUrlを返す（ハンドル検証成功）", async () => {
    const service = createContentService({
      fetch: fakeFetch({
        spoiler: jsonResult({ value: validRecord }),
        profile: jsonResult({ value: { displayName: "Alice" } }),
      }),
      didResolver: didResolverStub("alice.example.com"),
      handleResolver: handleResolverStub(DID),
    });

    const result = await service.getSpoiler(PARSED, "3rkey");
    expect(result).toEqual({
      text: "ネタバレ本文",
      createdAt: "2026-07-04T00:00:00.000Z",
      author: { did: DID, handle: "alice.example.com", displayName: "Alice" },
      announcementUrl: `https://bsky.app/profile/${DID}/post/3announcement`,
    });
  });

  it("ハンドルの双方向検証に失敗したらハンドルを省略する（本文は返す）", async () => {
    const service = createContentService({
      fetch: fakeFetch({
        spoiler: jsonResult({ value: validRecord }),
        profile: jsonResult({ value: { displayName: "Alice" } }),
      }),
      didResolver: didResolverStub("alice.example.com"),
      handleResolver: handleResolverStub("did:plc:someoneelse"),
    });

    const result = await service.getSpoiler(PARSED, "3rkey");
    expect(result?.author).toEqual({ did: DID, displayName: "Alice" });
  });

  it("プロフィール取得に失敗してもdisplayNameを省略して本文を返す", async () => {
    const service = createContentService({
      fetch: fakeFetch({
        spoiler: jsonResult({ value: validRecord }),
        profile: jsonResult({}, 404),
      }),
      didResolver: didResolverStub(null),
      handleResolver: handleResolverStub(null),
    });

    const result = await service.getSpoiler(PARSED, "3rkey");
    expect(result?.author).toEqual({ did: DID });
    expect(result?.text).toBe("ネタバレ本文");
  });

  it("DID解決に失敗したら null", async () => {
    const service = createContentService({
      fetch: fakeFetch({ spoiler: jsonResult({ value: validRecord }) }),
      didResolver: { resolve: vi.fn().mockResolvedValue(null) },
      handleResolver: handleResolverStub(null),
    });
    expect(await service.getSpoiler(PARSED, "3rkey")).toBeNull();
  });

  it("レコード取得が非200なら null", async () => {
    const service = createContentService({
      fetch: fakeFetch({ spoiler: jsonResult({}, 404) }),
      didResolver: didResolverStub(),
      handleResolver: handleResolverStub(null),
    });
    expect(await service.getSpoiler(PARSED, "3rkey")).toBeNull();
  });

  it("レコード形式が不正なら null", async () => {
    const service = createContentService({
      fetch: fakeFetch({ spoiler: jsonResult({ value: { $type: "wrong" } }) }),
      didResolver: didResolverStub(),
      handleResolver: handleResolverStub(null),
    });
    expect(await service.getSpoiler(PARSED, "3rkey")).toBeNull();
  });
});

describe("validateSpoilerRecord", () => {
  it("有効なレコードを受理する", () => {
    expect(validateSpoilerRecord(validRecord)).toEqual({
      text: "ネタバレ本文",
      createdAt: "2026-07-04T00:00:00.000Z",
      announcementRkey: "3announcement",
    });
  });

  it("$type不一致を拒否する", () => {
    expect(validateSpoilerRecord({ ...validRecord, $type: "app.bsky.feed.post" })).toBeNull();
  });

  it("空文字のtextを拒否する", () => {
    expect(validateSpoilerRecord({ ...validRecord, text: "" })).toBeNull();
  });

  it("7500バイト超のtextを拒否する", () => {
    expect(validateSpoilerRecord({ ...validRecord, text: "a".repeat(7501) })).toBeNull();
  });

  it("7500バイトちょうどは受理する", () => {
    expect(validateSpoilerRecord({ ...validRecord, text: "a".repeat(7500) })).not.toBeNull();
  });

  it("不正なcreatedAt・announcementRkeyを拒否する", () => {
    expect(validateSpoilerRecord({ ...validRecord, createdAt: "2026-07-04" })).toBeNull();
    expect(validateSpoilerRecord({ ...validRecord, announcementRkey: "bad/key" })).toBeNull();
  });

  it("オブジェクトでない値を拒否する", () => {
    expect(validateSpoilerRecord(null)).toBeNull();
    expect(validateSpoilerRecord("string")).toBeNull();
  });
});
