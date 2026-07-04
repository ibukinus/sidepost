import { describe, expect, it, vi } from "vitest";
import type { ParsedDid } from "../lib/atproto-syntax.js";
import type { SafeFetchOptions, SafeFetchResult } from "../lib/safe-fetch.js";
import type { DidResolver } from "./did.js";
import type { FetchFn } from "./pds-read.js";
import { createPdsReader, PdsReadError, PdsRecordNotFoundError } from "./pds-read.js";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const PDS = "https://pds.example.com";

interface RecordedCall {
  url: string;
  options?: SafeFetchOptions;
}

function jsonResult(body: unknown, status = 200): SafeFetchResult {
  return { status, headers: {}, body: Buffer.from(JSON.stringify(body), "utf8") };
}

/** 呼び出しを記録するフェイクfetch。 */
function recordingFetch(handler: (url: string) => SafeFetchResult): {
  fetch: FetchFn;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetch: FetchFn = async (url, options) => {
    calls.push({ url, ...(options !== undefined ? { options } : {}) });
    return handler(url);
  };
  return { fetch, calls };
}

function didResolverStub(pdsUrl: string | null = PDS): DidResolver {
  return {
    resolve: vi.fn(async (_parsed: ParsedDid) =>
      pdsUrl === null ? null : { pdsUrl, handleCandidate: null },
    ),
  };
}

const validRecord = {
  $type: "jp.mp0.skyseal.post",
  text: "本文",
  createdAt: "2026-07-04T00:00:00.000Z",
  announcementRkey: "3announce",
};

describe("createPdsReader.getRecord", () => {
  it("PDSの公開getRecordを認証なしで呼び、valueを返す", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResult({ value: validRecord }));
    const reader = createPdsReader({ fetch, didResolver: didResolverStub() });

    const value = await reader.getRecord(DID, "jp.mp0.skyseal.post", "3rkey");

    expect(value).toEqual(validRecord);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    // PDSのURLに対して呼ぶ。
    expect(call?.url).toBe(
      `${PDS}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(
        DID,
      )}&collection=${encodeURIComponent("jp.mp0.skyseal.post")}&rkey=3rkey`,
    );
    // GETである。
    expect(call?.options?.method).toBe("GET");
    // Authorizationヘッダを付けない（認証なし）。
    expect(call?.options?.headers).toBeUndefined();
  });

  it("400 + error:RecordNotFound は PdsRecordNotFoundError を投げる", async () => {
    const { fetch } = recordingFetch(() =>
      jsonResult({ error: "RecordNotFound", message: "Could not locate record" }, 400),
    );
    const reader = createPdsReader({ fetch, didResolver: didResolverStub() });

    await expect(reader.getRecord(DID, "jp.mp0.skyseal.post", "3rkey")).rejects.toBeInstanceOf(
      PdsRecordNotFoundError,
    );
  });

  it("その他の非200は PdsReadError(http-error) を投げる", async () => {
    const { fetch } = recordingFetch(() => jsonResult({ error: "InternalServerError" }, 500));
    const reader = createPdsReader({ fetch, didResolver: didResolverStub() });

    await expect(reader.getRecord(DID, "jp.mp0.skyseal.post", "3rkey")).rejects.toMatchObject({
      name: "PdsReadError",
      reason: "http-error",
    });
  });

  it("400でもRecordNotFound以外は PdsReadError（不在扱いにしない）", async () => {
    const { fetch } = recordingFetch(() => jsonResult({ error: "InvalidRequest" }, 400));
    const reader = createPdsReader({ fetch, didResolver: didResolverStub() });

    const err = await reader.getRecord(DID, "jp.mp0.skyseal.post", "3rkey").catch((e) => e);
    expect(err).toBeInstanceOf(PdsReadError);
    expect(err).not.toBeInstanceOf(PdsRecordNotFoundError);
  });

  it("DIDが解決できなければ PdsReadError(did-unresolved)", async () => {
    const { fetch } = recordingFetch(() => jsonResult({ value: validRecord }));
    const reader = createPdsReader({ fetch, didResolver: didResolverStub(null) });

    await expect(reader.getRecord(DID, "jp.mp0.skyseal.post", "3rkey")).rejects.toMatchObject({
      reason: "did-unresolved",
    });
  });

  it("DID構文が不正なら PdsReadError(invalid-did)（解決を試みない）", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResult({ value: validRecord }));
    const resolver = didResolverStub();
    const reader = createPdsReader({ fetch, didResolver: resolver });

    await expect(
      reader.getRecord("did:unsupported:x", "jp.mp0.skyseal.post", "3rkey"),
    ).rejects.toMatchObject({ reason: "invalid-did" });
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe("createPdsReader.listRecords", () => {
  it("公開listRecordsを認証なしで呼び、records/cursorを返す", async () => {
    const { fetch, calls } = recordingFetch(() =>
      jsonResult({
        cursor: "next",
        records: [
          { uri: `at://${DID}/jp.mp0.skyseal.post/rk`, cid: "cid", value: validRecord },
          // 不正なエントリ（uri欠落）は除外される。
          { cid: "cid2", value: {} },
        ],
      }),
    );
    const reader = createPdsReader({ fetch, didResolver: didResolverStub() });

    const result = await reader.listRecords(DID, "jp.mp0.skyseal.post", {
      limit: 50,
      reverse: true,
    });

    expect(result.cursor).toBe("next");
    expect(result.records).toEqual([
      { uri: `at://${DID}/jp.mp0.skyseal.post/rk`, cid: "cid", value: validRecord },
    ]);
    const call = calls[0];
    expect(call?.url).toContain(`${PDS}/xrpc/com.atproto.repo.listRecords?`);
    expect(call?.url).toContain(`repo=${encodeURIComponent(DID)}`);
    expect(call?.url).toContain("limit=50");
    expect(call?.url).toContain("reverse=true");
    expect(call?.options?.headers).toBeUndefined();
  });

  it("非200は PdsReadError(http-error)", async () => {
    const { fetch } = recordingFetch(() => jsonResult({ error: "x" }, 500));
    const reader = createPdsReader({ fetch, didResolver: didResolverStub() });

    await expect(reader.listRecords(DID, "jp.mp0.skyseal.post")).rejects.toMatchObject({
      reason: "http-error",
    });
  });
});

describe("createPdsReader.getLatestCommit", () => {
  it("公開getLatestCommitを認証なしで呼び、cid/revを返す", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResult({ cid: "bafycommit", rev: "3k" }));
    const reader = createPdsReader({ fetch, didResolver: didResolverStub() });

    const commit = await reader.getLatestCommit(DID);

    expect(commit).toEqual({ cid: "bafycommit", rev: "3k" });
    const call = calls[0];
    expect(call?.url).toBe(
      `${PDS}/xrpc/com.atproto.sync.getLatestCommit?did=${encodeURIComponent(DID)}`,
    );
    expect(call?.options?.headers).toBeUndefined();
  });

  it("cidが欠けていれば PdsReadError(http-error)", async () => {
    const { fetch } = recordingFetch(() => jsonResult({ rev: "3k" }));
    const reader = createPdsReader({ fetch, didResolver: didResolverStub() });

    await expect(reader.getLatestCommit(DID)).rejects.toMatchObject({ reason: "http-error" });
  });
});
