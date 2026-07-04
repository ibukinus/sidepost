import { describe, expect, it } from "vitest";
import { createTrustedProxyChecker, resolveClientIp, UNKNOWN_CLIENT_IP } from "./client-ip.js";

describe("createTrustedProxyChecker", () => {
  it("CIDR範囲内のIPを判定する", () => {
    const check = createTrustedProxyChecker(["10.0.0.0/8", "2001:db8::/32"]);
    expect(check("10.1.2.3")).toBe(true);
    expect(check("2001:db8::1")).toBe(true);
    expect(check("8.8.8.8")).toBe(false);
    expect(check("not-an-ip")).toBe(false);
  });
});

describe("resolveClientIp", () => {
  const trusted = createTrustedProxyChecker(["10.0.0.0/8"]);

  it("信頼プロキシ未設定時はX-Forwarded-Forを無視し接続元IPを使う", () => {
    expect(
      resolveClientIp({
        remoteAddress: "203.0.113.9",
        forwardedFor: "1.2.3.4",
        isTrustedProxy: () => false,
        hasTrustedProxies: false,
      }),
    ).toBe("203.0.113.9");
  });

  it("接続元が信頼プロキシ範囲外ならX-Forwarded-Forを無視する", () => {
    expect(
      resolveClientIp({
        remoteAddress: "203.0.113.9",
        forwardedFor: "1.2.3.4",
        isTrustedProxy: trusted,
        hasTrustedProxies: true,
      }),
    ).toBe("203.0.113.9");
  });

  it("接続元が信頼プロキシ範囲内なら右端から信頼プロキシを除いた値を採用する", () => {
    expect(
      resolveClientIp({
        remoteAddress: "10.0.0.1",
        forwardedFor: "203.0.113.9, 10.0.0.2",
        isTrustedProxy: trusted,
        hasTrustedProxies: true,
      }),
    ).toBe("203.0.113.9");
  });

  it("X-Forwarded-Forがすべて信頼プロキシなら接続元IPにフォールバックする", () => {
    expect(
      resolveClientIp({
        remoteAddress: "10.0.0.1",
        forwardedFor: "10.0.0.2, 10.0.0.3",
        isTrustedProxy: trusted,
        hasTrustedProxies: true,
      }),
    ).toBe("10.0.0.1");
  });

  it("ポート付きエントリからIPを取り出す", () => {
    expect(
      resolveClientIp({
        remoteAddress: "10.0.0.1",
        forwardedFor: "203.0.113.9:5555",
        isTrustedProxy: trusted,
        hasTrustedProxies: true,
      }),
    ).toBe("203.0.113.9");
  });

  it("接続元IPが不明な場合は代替キーを返す", () => {
    expect(
      resolveClientIp({
        remoteAddress: undefined,
        forwardedFor: undefined,
        isTrustedProxy: trusted,
        hasTrustedProxies: true,
      }),
    ).toBe(UNKNOWN_CLIENT_IP);
  });
});
