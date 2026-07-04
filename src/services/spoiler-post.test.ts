import type { Agent } from "@atproto/api";
import { describe, expect, it, vi } from "vitest";
import { utf8ByteLength } from "../lib/atproto-syntax.js";
import { isValidTid } from "../lib/tid.js";
import {
  buildAnnouncementFacets,
  buildAnnouncementText,
  buildApplyWritesInput,
  buildDedicatedUrl,
  createSpoilerPost,
  SpoilerPostWriteError,
  validateComposeText,
} from "./spoiler-post.js";

describe("validateComposeText", () => {
  it("通常の本文を受け入れる", () => {
    expect(validateComposeText("ネタバレ本文")).toBeNull();
  });

  it("空文字列を拒否する", () => {
    expect(validateComposeText("")).toBe("empty");
  });

  it("空白のみの文字列を拒否する（全角・半角・改行混在）", () => {
    expect(validateComposeText("   \n\t　　\n")).toBe("empty");
  });

  it("7,500バイトちょうどは許可する", () => {
    const text = "a".repeat(7500);
    expect(utf8ByteLength(text)).toBe(7500);
    expect(validateComposeText(text)).toBeNull();
  });

  it("7,500バイトを超えると拒否する", () => {
    const text = "a".repeat(7501);
    expect(validateComposeText(text)).toBe("too-long");
  });

  it("マルチバイト文字でもバイト数で判定する", () => {
    // 「あ」はUTF-8で3バイト。2500文字で7500バイトちょうど。
    const text = "あ".repeat(2500);
    expect(utf8ByteLength(text)).toBe(7500);
    expect(validateComposeText(text)).toBeNull();
    expect(validateComposeText(`${text}あ`)).toBe("too-long");
  });
});

describe("buildDedicatedUrl", () => {
  it("origin・did・rkeyから専用URLを組み立てる", () => {
    expect(buildDedicatedUrl("https://skyseal.mp0.jp", "did:plc:abc", "3xyz")).toBe(
      "https://skyseal.mp0.jp/p/did:plc:abc/3xyz",
    );
  });
});

describe("buildAnnouncementText", () => {
  it("固定文言＋URLの案内投稿本文を生成する", () => {
    const url = "https://skyseal.mp0.jp/p/did:plc:abc/3xyz";
    expect(buildAnnouncementText(url)).toBe(`ネタバレを含む投稿です。\n\n${url}`);
  });
});

describe("buildAnnouncementFacets", () => {
  it("URL部分の正確なUTF-8バイト範囲でlink facetを構築する", () => {
    const url = "https://skyseal.mp0.jp/p/did:plc:abc/3xyz";
    const text = buildAnnouncementText(url);
    const facets = buildAnnouncementFacets(url);
    expect(facets).toHaveLength(1);
    const facet = facets[0];
    if (!facet) throw new Error("facet is undefined");

    const { byteStart, byteEnd } = facet.index;
    // facetのバイト範囲がテキスト全体のバイト列の中でURL部分と一致することを確認する。
    const fullBytes = Buffer.from(text, "utf8");
    const slice = fullBytes.subarray(byteStart, byteEnd).toString("utf8");
    expect(slice).toBe(url);
    expect(byteEnd).toBe(Buffer.byteLength(text, "utf8"));

    expect(facet.features).toEqual([{ $type: "app.bsky.richtext.facet#link", uri: url }]);
  });

  it("固定プレフィックスは日本語を含むためbyteStartは文字数と一致しない", () => {
    const url = "https://example.com/x";
    const facet = buildAnnouncementFacets(url)[0];
    if (!facet) throw new Error("facet is undefined");
    // "ネタバレを含む投稿です。\n\n" は12文字だが、日本語部分(10文字)が3バイトずつのため
    // 単純な文字数(12)より大きいバイト数になる。
    expect(facet.index.byteStart).toBeGreaterThan("ネタバレを含む投稿です。\n\n".length);
  });
});

describe("buildApplyWritesInput", () => {
  const base = {
    did: "did:plc:abc",
    text: "ネタバレ本文",
    createdAt: "2026-07-04T00:00:00.000Z",
    rkeyPost: "3labc0000000a",
    rkeyAnnounce: "3labc0000000b",
    dedicatedUrl: "https://skyseal.mp0.jp/p/did:plc:abc/3labc0000000a",
  };

  it("repoとwrites配列（2件）を組み立てる", () => {
    const input = buildApplyWritesInput(base);
    expect(input.repo).toBe(base.did);
    expect(input.writes).toHaveLength(2);
  });

  it("1件目は本文レコード（jp.mp0.skyseal.post）の作成", () => {
    const input = buildApplyWritesInput(base);
    const write = input.writes[0] as unknown as Record<string, unknown>;
    expect(write.$type).toBe("com.atproto.repo.applyWrites#create");
    expect(write.collection).toBe("jp.mp0.skyseal.post");
    expect(write.rkey).toBe(base.rkeyPost);
    expect(write.value).toEqual({
      $type: "jp.mp0.skyseal.post",
      text: base.text,
      createdAt: base.createdAt,
      announcementRkey: base.rkeyAnnounce,
    });
  });

  it("2件目は案内投稿（app.bsky.feed.post）の作成で、本文レコードのテキストを含まない", () => {
    const input = buildApplyWritesInput(base);
    const write = input.writes[1] as unknown as Record<string, unknown>;
    expect(write.$type).toBe("com.atproto.repo.applyWrites#create");
    expect(write.collection).toBe("app.bsky.feed.post");
    expect(write.rkey).toBe(base.rkeyAnnounce);

    const value = write.value as Record<string, unknown>;
    expect(value.$type).toBe("app.bsky.feed.post");
    expect(value.langs).toEqual(["ja"]);
    expect(value.createdAt).toBe(base.createdAt);
    expect(value.text).not.toContain(base.text);
    expect(value.text).toBe(`ネタバレを含む投稿です。\n\n${base.dedicatedUrl}`);

    const embed = value.embed as Record<string, unknown>;
    expect(embed).toEqual({
      $type: "app.bsky.embed.external",
      external: {
        uri: base.dedicatedUrl,
        title: "ネタバレ投稿",
        description: "ネタバレを含む投稿です。",
      },
    });
    // サムネイルは設定しない（要件6.4）。
    expect((embed.external as Record<string, unknown>).thumb).toBeUndefined();
  });
});

describe("createSpoilerPost", () => {
  function fakeAgent(applyWrites: (input: unknown) => Promise<unknown>): Agent {
    return {
      com: { atproto: { repo: { applyWrites } } },
    } as unknown as Agent;
  }

  it("TIDを2つ生成し、applyWritesを1回だけ呼ぶ", async () => {
    const applyWrites = vi.fn().mockResolvedValue({ success: true, data: {} });
    const agent = fakeAgent(applyWrites);

    const result = await createSpoilerPost(
      agent,
      "https://skyseal.mp0.jp",
      "did:plc:abc",
      "ネタバレ本文",
    );

    expect(applyWrites).toHaveBeenCalledTimes(1);
    expect(isValidTid(result.rkeyPost)).toBe(true);
    expect(isValidTid(result.rkeyAnnounce)).toBe(true);
    expect(result.rkeyPost).not.toBe(result.rkeyAnnounce);
    expect(result.dedicatedUrl).toBe(`https://skyseal.mp0.jp/p/did:plc:abc/${result.rkeyPost}`);

    const calledWith = applyWrites.mock.calls[0]?.[0] as { writes: unknown[] };
    expect(calledWith.writes).toHaveLength(2);
  });

  it("PDS書き込み失敗時はSpoilerPostWriteErrorを投げ、本文・生エラーをメッセージに含めない", async () => {
    const rawError = new Error("PDSからの生レスポンス: ネタバレ本文が含まれるかもしれない詳細");
    const applyWrites = vi.fn().mockRejectedValue(rawError);
    const agent = fakeAgent(applyWrites);

    let caught: unknown;
    try {
      await createSpoilerPost(agent, "https://skyseal.mp0.jp", "did:plc:abc", "本文");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SpoilerPostWriteError);
    const err = caught as SpoilerPostWriteError;
    expect(err.message).not.toContain("本文");
    expect(err.message).not.toBe(rawError.message);
    expect(err.cause).toBe(rawError);
  });
});
