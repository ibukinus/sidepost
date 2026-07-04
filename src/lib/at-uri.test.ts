import { describe, expect, it } from "vitest";
import { buildAnnouncementUrl, buildDedicatedUrl, encodeDidSegment } from "./at-uri.js";

describe("encodeDidSegment", () => {
  it("did:plc はそのまま返す", () => {
    expect(encodeDidSegment("did:plc:abcdefghijklmnopqrstuvwx")).toBe(
      "did:plc:abcdefghijklmnopqrstuvwx",
    );
  });

  it("ポートなしの did:web はそのまま返す", () => {
    expect(encodeDidSegment("did:web:example.com")).toBe("did:web:example.com");
  });

  it("did:web の %3A（ポート区切り）を %253A にエスケープする", () => {
    expect(encodeDidSegment("did:web:example.com%3A3000")).toBe("did:web:example.com%253A3000");
  });

  it("エスケープ結果はパスデコードで元のDIDに戻る", () => {
    const did = "did:web:example.com%3A3000";
    expect(decodeURIComponent(encodeDidSegment(did))).toBe(did);
  });
});

describe("buildDedicatedUrl", () => {
  it("origin・DID・rkeyから専用ページURLを構築する", () => {
    expect(buildDedicatedUrl("https://skyseal.mp0.jp", "did:plc:abc", "3xyz")).toBe(
      "https://skyseal.mp0.jp/p/did:plc:abc/3xyz",
    );
  });

  it("ポート付き did:web ではDIDをエンコードして構築する", () => {
    expect(buildDedicatedUrl("https://skyseal.mp0.jp", "did:web:example.com%3A3000", "3xyz")).toBe(
      "https://skyseal.mp0.jp/p/did:web:example.com%253A3000/3xyz",
    );
  });
});

describe("buildAnnouncementUrl", () => {
  it("Blueskyの案内投稿URLを構築する", () => {
    expect(buildAnnouncementUrl("did:plc:abc", "3announce")).toBe(
      "https://bsky.app/profile/did:plc:abc/post/3announce",
    );
  });

  it("ポート付き did:web ではDIDをエンコードして構築する", () => {
    expect(buildAnnouncementUrl("did:web:example.com%3A3000", "3announce")).toBe(
      "https://bsky.app/profile/did:web:example.com%253A3000/post/3announce",
    );
  });
});
