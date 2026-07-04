import { describe, expect, it } from "vitest";
import { SafeFetchError, safeFetch } from "./safe-fetch.js";

// これらのテストは、接続前に完了する同期的な検証ゲート（URL構文・スキーム・
// IPリテラルの許可判定）のみを対象とする。実際のネットワークI/O（タイムアウト・
// サイズ上限の実挙動）はCIで安定させにくいため統合テストの範囲とし、ここでは扱わない。

async function expectReason(promise: Promise<unknown>, reason: string) {
  await expect(promise).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(SafeFetchError);
    expect((err as SafeFetchError).reason).toBe(reason);
    return true;
  });
}

describe("safeFetch", () => {
  it("不正なURLを拒否する", async () => {
    await expectReason(safeFetch("not a url"), "invalid-url");
  });

  it("httpスキームを拒否する", async () => {
    await expectReason(safeFetch("http://example.com/"), "disallowed-scheme");
  });

  it("ftpスキームを拒否する", async () => {
    await expectReason(safeFetch("ftp://example.com/"), "disallowed-scheme");
  });

  it("ループバックIPリテラルを拒否する", async () => {
    await expectReason(safeFetch("https://127.0.0.1/"), "disallowed-address");
  });

  it("プライベートIPリテラルを拒否する", async () => {
    await expectReason(safeFetch("https://10.0.0.1/"), "disallowed-address");
  });

  it("IPv6ループバックリテラルを拒否する", async () => {
    await expectReason(safeFetch("https://[::1]/"), "disallowed-address");
  });

  it("存在しないホスト名はdns-resolution-failedを返す", async () => {
    await expectReason(
      safeFetch("https://this-host-should-not-exist.invalid/"),
      "dns-resolution-failed",
    );
  });
});
