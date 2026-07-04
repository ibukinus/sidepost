import { ComAtprotoRepoApplyWrites, ComAtprotoRepoGetRecord, XRPCError } from "@atproto/api";
import { describe, expect, it, vi } from "vitest";
import {
  buildDedicatedUrl,
  deleteSpoilerPost,
  isMatchingAnnouncement,
  listSpoilerPosts,
  type RepoAgent,
  truncateExcerpt,
} from "./manage.js";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const ORIGIN = "https://skyseal.example.com";

function notFound(): ComAtprotoRepoGetRecord.RecordNotFoundError {
  return new ComAtprotoRepoGetRecord.RecordNotFoundError(
    new XRPCError(400, "RecordNotFound", "Could not locate record"),
  );
}

function invalidSwap(): ComAtprotoRepoApplyWrites.InvalidSwapError {
  return new ComAtprotoRepoApplyWrites.InvalidSwapError(
    new XRPCError(409, "InvalidSwap", "Commit was too old"),
  );
}

function fakeAgent(overrides: Partial<RepoAgent["com"]["atproto"]> = {}): RepoAgent {
  return {
    com: {
      atproto: {
        repo: {
          listRecords: vi.fn().mockResolvedValue({ data: { records: [] } }),
          getRecord: vi.fn().mockRejectedValue(notFound()),
          applyWrites: vi.fn().mockResolvedValue({ data: {} }),
          ...overrides.repo,
        },
        sync: {
          getLatestCommit: vi.fn().mockResolvedValue({ data: { cid: "bafycommit", rev: "1" } }),
          ...overrides.sync,
        },
      },
    },
  };
}

describe("truncateExcerpt", () => {
  it("上限以下ならそのまま返す", () => {
    expect(truncateExcerpt("短い本文")).toBe("短い本文");
  });

  it("上限を超えたら末尾を…に置き換える（コードポイント単位）", () => {
    const text = "あ".repeat(60);
    const result = truncateExcerpt(text, 50);
    expect(Array.from(result.replace("…", "")).length).toBe(50);
    expect(result.endsWith("…")).toBe(true);
  });

  it("連続する空白・改行を1個のスペースに畳む", () => {
    expect(truncateExcerpt("1行目\n\n  2行目\t3行目")).toBe("1行目 2行目 3行目");
  });
});

describe("buildDedicatedUrl / isMatchingAnnouncement", () => {
  const rkey = "3juf5s2xku2v";

  it("固定テンプレートと完全一致すれば true", () => {
    const value = {
      $type: "app.bsky.feed.post",
      text: `ネタバレを含む投稿です。\n\n${buildDedicatedUrl(ORIGIN, DID, rkey)}`,
    };
    expect(isMatchingAnnouncement(value, ORIGIN, DID, rkey)).toBe(true);
  });

  it("$typeが違えば false", () => {
    const value = {
      $type: "jp.mp0.skyseal.post",
      text: `ネタバレを含む投稿です。\n\n${buildDedicatedUrl(ORIGIN, DID, rkey)}`,
    };
    expect(isMatchingAnnouncement(value, ORIGIN, DID, rkey)).toBe(false);
  });

  it("URLが別のrkeyを指していれば false", () => {
    const value = {
      $type: "app.bsky.feed.post",
      text: `ネタバレを含む投稿です。\n\n${buildDedicatedUrl(ORIGIN, DID, "different-rkey")}`,
    };
    expect(isMatchingAnnouncement(value, ORIGIN, DID, rkey)).toBe(false);
  });

  it("文言が追加・変更されていれば false", () => {
    const value = {
      $type: "app.bsky.feed.post",
      text: `ネタバレを含む投稿です！\n\n${buildDedicatedUrl(ORIGIN, DID, rkey)}`,
    };
    expect(isMatchingAnnouncement(value, ORIGIN, DID, rkey)).toBe(false);
  });

  it("非オブジェクト・null は false", () => {
    expect(isMatchingAnnouncement(null, ORIGIN, DID, rkey)).toBe(false);
    expect(isMatchingAnnouncement("text", ORIGIN, DID, rkey)).toBe(false);
  });
});

describe("listSpoilerPosts", () => {
  it("レコードを新しい順（reverse指定）・件数上限50で問い合わせ、一覧項目に変換する", async () => {
    const listRecords = vi.fn().mockResolvedValue({
      data: {
        cursor: "next-cursor",
        records: [
          {
            uri: `at://${DID}/jp.mp0.skyseal.post/rkey1`,
            cid: "cid1",
            value: {
              $type: "jp.mp0.skyseal.post",
              text: "本文1",
              createdAt: "2026-07-01T00:00:00.000Z",
              announcementRkey: "announce1",
            },
          },
        ],
      },
    });
    const agent = fakeAgent({ repo: { listRecords } as never });

    const page = await listSpoilerPosts(agent, DID, "cursor-in");

    expect(listRecords).toHaveBeenCalledWith({
      repo: DID,
      collection: "jp.mp0.skyseal.post",
      limit: 50,
      cursor: "cursor-in",
      reverse: true,
    });
    expect(page.items).toEqual([
      { rkey: "rkey1", createdAt: "2026-07-01T00:00:00.000Z", excerpt: "本文1" },
    ]);
    expect(page.nextCursor).toBe("next-cursor");
  });

  it("形式が不正なレコードは一覧から除外する", async () => {
    const listRecords = vi.fn().mockResolvedValue({
      data: {
        records: [
          { uri: `at://${DID}/jp.mp0.skyseal.post/bad`, cid: "cid", value: { text: 123 } },
          {
            uri: `at://${DID}/jp.mp0.skyseal.post/ok`,
            cid: "cid2",
            value: {
              $type: "jp.mp0.skyseal.post",
              text: "有効な本文",
              createdAt: "2026-07-01T00:00:00.000Z",
              announcementRkey: "announce1",
            },
          },
        ],
      },
    });
    const agent = fakeAgent({ repo: { listRecords } as never });

    const page = await listSpoilerPosts(agent, DID);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.rkey).toBe("ok");
    expect(page.nextCursor).toBeUndefined();
  });

  it("URIから取り出したrkeyがrecord-key構文に適合しない場合も除外する", async () => {
    const listRecords = vi.fn().mockResolvedValue({
      data: {
        records: [
          {
            // ".." はrecord-keyとして不正（lib/atproto-syntax.ts）。
            uri: `at://${DID}/jp.mp0.skyseal.post/..`,
            cid: "cid",
            value: {
              $type: "jp.mp0.skyseal.post",
              text: "本文",
              createdAt: "2026-07-01T00:00:00.000Z",
              announcementRkey: "announce1",
            },
          },
        ],
      },
    });
    const agent = fakeAgent({ repo: { listRecords } as never });

    const page = await listSpoilerPosts(agent, DID);

    expect(page.items).toHaveLength(0);
  });
});

describe("deleteSpoilerPost", () => {
  const rkey = "3juf5s2xku2v";
  const announcementRkey = "3announcexxx";

  function spoilerRecordValue() {
    return {
      $type: "jp.mp0.skyseal.post",
      text: "本文",
      createdAt: "2026-07-01T00:00:00.000Z",
      announcementRkey,
    };
  }

  it("不正なrkey構文はPDSへ問い合わせず invalid-rkey を返す", async () => {
    const getRecord = vi.fn();
    const agent = fakeAgent({ repo: { getRecord } as never });

    const result = await deleteSpoilerPost(agent, { did: DID, rkey: "bad key", origin: ORIGIN });

    expect(result).toEqual({ ok: false, reason: "invalid-rkey" });
    expect(getRecord).not.toHaveBeenCalled();
  });

  it("本文レコードが存在しなければ、すでに削除済みとして成功扱いにする（applyWritesは呼ばない）", async () => {
    const getRecord = vi.fn().mockRejectedValue(notFound());
    const applyWrites = vi.fn();
    const agent = fakeAgent({ repo: { getRecord, applyWrites } as never });

    const result = await deleteSpoilerPost(agent, { did: DID, rkey, origin: ORIGIN });

    expect(result).toEqual({ ok: true });
    expect(applyWrites).not.toHaveBeenCalled();
  });

  it("本文レコード取得時の一般的なPDSエラーは pds-error として返す（削除済み扱いにしない）", async () => {
    const getRecord = vi.fn().mockRejectedValue(new Error("network down"));
    const agent = fakeAgent({ repo: { getRecord } as never });

    const result = await deleteSpoilerPost(agent, { did: DID, rkey, origin: ORIGIN });

    expect(result).toEqual({ ok: false, reason: "pds-error" });
  });

  it("案内投稿が固定テンプレートと一致すれば、両方をswapCommit付きで一括削除する", async () => {
    const getRecord = vi
      .fn()
      .mockResolvedValueOnce({ data: { value: spoilerRecordValue() } })
      .mockResolvedValueOnce({
        data: {
          value: {
            $type: "app.bsky.feed.post",
            text: `ネタバレを含む投稿です。\n\n${buildDedicatedUrl(ORIGIN, DID, rkey)}`,
          },
        },
      });
    const applyWrites = vi.fn().mockResolvedValue({ data: {} });
    const getLatestCommit = vi.fn().mockResolvedValue({ data: { cid: "bafycommit", rev: "1" } });
    const agent = fakeAgent({
      repo: { getRecord, applyWrites } as never,
      sync: { getLatestCommit } as never,
    });

    const result = await deleteSpoilerPost(agent, { did: DID, rkey, origin: ORIGIN });

    expect(result).toEqual({ ok: true });
    expect(applyWrites).toHaveBeenCalledWith({
      repo: DID,
      swapCommit: "bafycommit",
      writes: [
        { $type: "com.atproto.repo.applyWrites#delete", collection: "jp.mp0.skyseal.post", rkey },
        {
          $type: "com.atproto.repo.applyWrites#delete",
          collection: "app.bsky.feed.post",
          rkey: announcementRkey,
        },
      ],
    });
  });

  it("案内投稿がすでに削除されていれば本文レコードのみ削除する", async () => {
    const getRecord = vi
      .fn()
      .mockResolvedValueOnce({ data: { value: spoilerRecordValue() } })
      .mockRejectedValueOnce(notFound());
    const applyWrites = vi.fn().mockResolvedValue({ data: {} });
    const agent = fakeAgent({ repo: { getRecord, applyWrites } as never });

    const result = await deleteSpoilerPost(agent, { did: DID, rkey, origin: ORIGIN });

    expect(result).toEqual({ ok: true });
    expect(applyWrites).toHaveBeenCalledWith({
      repo: DID,
      swapCommit: "bafycommit",
      writes: [
        { $type: "com.atproto.repo.applyWrites#delete", collection: "jp.mp0.skyseal.post", rkey },
      ],
    });
  });

  it("案内投稿が固定テンプレートに一致しなければ削除対象に含めない（無関係な投稿の巻き添え削除防止）", async () => {
    const getRecord = vi
      .fn()
      .mockResolvedValueOnce({ data: { value: spoilerRecordValue() } })
      .mockResolvedValueOnce({
        data: { value: { $type: "app.bsky.feed.post", text: "全然関係ない投稿" } },
      });
    const applyWrites = vi.fn().mockResolvedValue({ data: {} });
    const agent = fakeAgent({ repo: { getRecord, applyWrites } as never });

    const result = await deleteSpoilerPost(agent, { did: DID, rkey, origin: ORIGIN });

    expect(result).toEqual({ ok: true });
    expect(applyWrites).toHaveBeenCalledWith({
      repo: DID,
      swapCommit: "bafycommit",
      writes: [
        { $type: "com.atproto.repo.applyWrites#delete", collection: "jp.mp0.skyseal.post", rkey },
      ],
    });
  });

  it("swapCommit衝突時は swap-conflict を返し、自動リトライしない", async () => {
    const getRecord = vi
      .fn()
      .mockResolvedValueOnce({ data: { value: spoilerRecordValue() } })
      .mockRejectedValueOnce(notFound());
    const applyWrites = vi.fn().mockRejectedValue(invalidSwap());
    const agent = fakeAgent({ repo: { getRecord, applyWrites } as never });

    const result = await deleteSpoilerPost(agent, { did: DID, rkey, origin: ORIGIN });

    expect(result).toEqual({ ok: false, reason: "swap-conflict" });
    expect(applyWrites).toHaveBeenCalledTimes(1);
  });

  it("コミットCID取得に失敗した場合は pds-error を返し、本文レコードの取得もapplyWritesも行わない", async () => {
    // swapCommitは読み取りより前に観測するため、これが失敗すれば以降のPDS呼び出しは発生しない。
    const getRecord = vi.fn();
    const applyWrites = vi.fn();
    const getLatestCommit = vi.fn().mockRejectedValue(new Error("boom"));
    const agent = fakeAgent({
      repo: { getRecord, applyWrites } as never,
      sync: { getLatestCommit } as never,
    });

    const result = await deleteSpoilerPost(agent, { did: DID, rkey, origin: ORIGIN });

    expect(result).toEqual({ ok: false, reason: "pds-error" });
    expect(getRecord).not.toHaveBeenCalled();
    expect(applyWrites).not.toHaveBeenCalled();
  });

  it("swapCommitは読み取りより前（本文レコード取得前）に観測する（TOCTOU対策）", async () => {
    const callOrder: string[] = [];
    const getRecord = vi
      .fn()
      .mockImplementationOnce(async () => {
        callOrder.push("getRecord:spoiler");
        return { data: { value: spoilerRecordValue() } };
      })
      .mockImplementationOnce(async () => {
        callOrder.push("getRecord:announcement");
        throw notFound();
      });
    const getLatestCommit = vi.fn().mockImplementation(async () => {
      callOrder.push("getLatestCommit");
      return { data: { cid: "bafycommit", rev: "1" } };
    });
    const agent = fakeAgent({
      repo: { getRecord } as never,
      sync: { getLatestCommit } as never,
    });

    await deleteSpoilerPost(agent, { did: DID, rkey, origin: ORIGIN });

    expect(callOrder).toEqual(["getLatestCommit", "getRecord:spoiler", "getRecord:announcement"]);
  });
});
