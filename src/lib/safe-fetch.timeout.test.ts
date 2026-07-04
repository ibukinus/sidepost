import { describe, expect, it, vi } from "vitest";

// dns.lookupはAbortSignalを認識しないため、DNS解決自体がハングした場合に
// safeFetchの合計タイムアウトが正しく機能するかは、実ネットワークのタイミングに
// 依存させると不安定になる。ここではdns.lookupが永久に解決しないようモックし、
// タイムアウトが実ネットワークの応答を待たずに発火することを検証する。
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(() => new Promise(() => {})),
}));

const { SafeFetchError, safeFetch } = await import("./safe-fetch.js");

describe("safeFetch のタイムアウト（DNS解決がハングする場合）", () => {
  it("DNS解決が完了しなくても合計タイムアウトで打ち切る", async () => {
    await expect(
      safeFetch("https://dns-hang.example.invalid/", { timeoutMs: 20 }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SafeFetchError);
      expect((err as InstanceType<typeof SafeFetchError>).reason).toBe("timeout");
      return true;
    });
  });
});
