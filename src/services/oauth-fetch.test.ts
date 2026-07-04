import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeFetchResult } from "../lib/safe-fetch.js";
import { SafeFetchError, safeFetch } from "../lib/safe-fetch.js";
import { createOAuthFetch } from "./oauth-fetch.js";

vi.mock("../lib/safe-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/safe-fetch.js")>();
  return { ...actual, safeFetch: vi.fn() };
});

const mockedSafeFetch = vi.mocked(safeFetch);

function result(partial: Partial<SafeFetchResult>): SafeFetchResult {
  return {
    status: 200,
    headers: {},
    body: Buffer.alloc(0),
    ...partial,
  };
}

describe("createOAuthFetch", () => {
  beforeEach(() => {
    mockedSafeFetch.mockReset();
  });

  it("safeFetch経由でレスポンスを組み立てる", async () => {
    mockedSafeFetch.mockResolvedValue(
      result({
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ a: 1 })),
      }),
    );
    const fetchImpl = createOAuthFetch();
    const res = await fetchImpl("https://pds.example/xrpc/foo");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ a: 1 });
    expect(mockedSafeFetch).toHaveBeenCalledWith(
      "https://pds.example/xrpc/foo",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("危険なリクエストヘッダを落とし accept-encoding を identity にする", async () => {
    mockedSafeFetch.mockResolvedValue(result({}));
    const fetchImpl = createOAuthFetch();
    await fetchImpl("https://pds.example/x", {
      headers: { host: "evil", "content-length": "5", "x-keep": "yes", "accept-encoding": "gzip" },
    });
    const passedHeaders = mockedSafeFetch.mock.calls[0]?.[1]?.headers ?? {};
    expect(passedHeaders["x-keep"]).toBe("yes");
    expect(passedHeaders["accept-encoding"]).toBe("identity");
    expect("host" in passedHeaders).toBe(false);
    expect("content-length" in passedHeaders).toBe(false);
  });

  it("POSTボディを転送する", async () => {
    mockedSafeFetch.mockResolvedValue(result({}));
    const fetchImpl = createOAuthFetch();
    await fetchImpl("https://pds.example/x", {
      method: "POST",
      body: "grant_type=authorization_code",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const passedBody = mockedSafeFetch.mock.calls[0]?.[1]?.body;
    expect(passedBody).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(passedBody as Uint8Array).toString("utf8")).toBe(
      "grant_type=authorization_code",
    );
  });

  it("レスポンスの content-encoding を落とす", async () => {
    mockedSafeFetch.mockResolvedValue(
      result({
        status: 200,
        headers: { "content-encoding": "gzip", "x-dpop-nonce": "n" },
        body: Buffer.from("x"),
      }),
    );
    const res = await createOAuthFetch()("https://pds.example/x");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("x-dpop-nonce")).toBe("n");
  });

  it("204はボディなしのResponseにする", async () => {
    mockedSafeFetch.mockResolvedValue(result({ status: 204, body: Buffer.alloc(0) }));
    const res = await createOAuthFetch()("https://pds.example/x");
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("未対応メソッドを拒否する", async () => {
    await expect(
      createOAuthFetch()("https://pds.example/x", { method: "PUT" }),
    ).rejects.toBeInstanceOf(SafeFetchError);
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });
});
