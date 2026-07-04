import { describe, expect, it, vi } from "vitest";
import type { ParsedDid } from "../lib/atproto-syntax.js";
import type { SafeFetchResult } from "../lib/safe-fetch.js";
import { SafeFetchError } from "../lib/safe-fetch.js";
import { createDidResolver, type FetchFn } from "./did.js";

const PLC_DID = "did:plc:abcdefghijklmnopqrstuvwx";
const PLC_PARSED: ParsedDid = { method: "plc", did: PLC_DID };

function jsonResult(body: unknown, status = 200): SafeFetchResult {
  return {
    status,
    headers: {},
    body: Buffer.from(JSON.stringify(body), "utf8"),
  };
}

function didDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PLC_DID,
    alsoKnownAs: ["at://alice.example.com"],
    service: [
      {
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: "https://pds.example.com",
      },
    ],
    ...overrides,
  };
}

describe("createDidResolver", () => {
  it("did:plc を plc.directory から解決しPDSとハンドル候補を返す", async () => {
    const fetch = vi.fn<FetchFn>().mockResolvedValue(jsonResult(didDoc()));
    const resolver = createDidResolver({ fetch });

    const resolved = await resolver.resolve(PLC_PARSED);

    expect(resolved).toEqual({
      pdsUrl: "https://pds.example.com",
      handleCandidate: "alice.example.com",
    });
    expect(fetch).toHaveBeenCalledWith(
      `https://plc.directory/${PLC_DID}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("did:web を well-known から解決する", async () => {
    const webDid = "did:web:example.com";
    const fetch = vi.fn<FetchFn>().mockResolvedValue(jsonResult(didDoc({ id: webDid })));
    const resolver = createDidResolver({ fetch });

    const resolved = await resolver.resolve({ method: "web", did: webDid, host: "example.com" });

    expect(resolved?.pdsUrl).toBe("https://pds.example.com");
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/.well-known/did.json",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("DIDドキュメントのidが不一致なら null", async () => {
    const fetch = vi.fn<FetchFn>().mockResolvedValue(jsonResult(didDoc({ id: "did:plc:other" })));
    const resolver = createDidResolver({ fetch });
    expect(await resolver.resolve(PLC_PARSED)).toBeNull();
  });

  it("PDSサービスが無ければ null", async () => {
    const fetch = vi.fn<FetchFn>().mockResolvedValue(jsonResult(didDoc({ service: [] })));
    const resolver = createDidResolver({ fetch });
    expect(await resolver.resolve(PLC_PARSED)).toBeNull();
  });

  it("PDSエンドポイントがhttpsでなければ null（フォールバックしない）", async () => {
    const fetch = vi.fn<FetchFn>().mockResolvedValue(
      jsonResult(
        didDoc({
          service: [
            {
              id: "#atproto_pds",
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "http://pds.example.com",
            },
          ],
        }),
      ),
    );
    const resolver = createDidResolver({ fetch });
    expect(await resolver.resolve(PLC_PARSED)).toBeNull();
  });

  it("ハンドル候補が無い（alsoKnownAsなし）場合は handleCandidate=null", async () => {
    const fetch = vi.fn<FetchFn>().mockResolvedValue(jsonResult(didDoc({ alsoKnownAs: [] })));
    const resolver = createDidResolver({ fetch });
    expect((await resolver.resolve(PLC_PARSED))?.handleCandidate).toBeNull();
  });

  it("非200・fetch例外・不正JSONは null", async () => {
    const r1 = createDidResolver({
      fetch: vi.fn<FetchFn>().mockResolvedValue(jsonResult({}, 404)),
    });
    expect(await r1.resolve(PLC_PARSED)).toBeNull();

    const r2 = createDidResolver({
      fetch: vi.fn<FetchFn>().mockRejectedValue(new SafeFetchError("timeout", "x")),
    });
    expect(await r2.resolve(PLC_PARSED)).toBeNull();

    const r3 = createDidResolver({
      fetch: vi
        .fn<FetchFn>()
        .mockResolvedValue({ status: 200, headers: {}, body: Buffer.from("not json") }),
    });
    expect(await r3.resolve(PLC_PARSED)).toBeNull();
  });

  it("TTL内はキャッシュを使い、期限切れで再取得する", async () => {
    let clock = 1000;
    const fetch = vi.fn<FetchFn>().mockResolvedValue(jsonResult(didDoc()));
    const resolver = createDidResolver({ fetch, now: () => clock, cacheTtlMs: 5000 });

    await resolver.resolve(PLC_PARSED);
    await resolver.resolve(PLC_PARSED);
    expect(fetch).toHaveBeenCalledTimes(1);

    clock += 6000;
    await resolver.resolve(PLC_PARSED);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
