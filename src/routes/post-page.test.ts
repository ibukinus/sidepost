import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ContentService, SpoilerResult } from "../services/content.js";
import type { DenylistService } from "../services/denylist.js";
import type { AppEnv } from "../types.js";
import { createPostPageRoute } from "./post-page.js";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const RKEY = "3juf5s2xku2v";

const sampleResult: SpoilerResult = {
  text: "ネタバレ本文",
  createdAt: "2026-07-04T00:00:00.000Z",
  author: { did: DID, handle: "alice.example.com", displayName: "Alice" },
  announcementUrl: `https://bsky.app/profile/${DID}/post/3announcement`,
};

function denylistStub(denied = false): DenylistService {
  return {
    isDenied: vi.fn().mockReturnValue(denied),
    reload: vi.fn(),
    stop: vi.fn(),
  };
}

function contentStub(
  getSpoiler: ContentService["getSpoiler"] = async () => sampleResult,
): ContentService {
  return { getSpoiler };
}

function buildApp(deps?: { denylist?: DenylistService; content?: ContentService }): Hono<AppEnv> {
  return createPostPageRoute({
    denylist: deps?.denylist ?? denylistStub(),
    content: deps?.content ?? contentStub(),
  });
}

function expectPageHeaders(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nosnippet, noarchive");
}

describe("post-page route (GET /p/{did}/{rkey})", () => {
  it("表示可能なら200を返し、本文・投稿者情報を含まない初期HTMLを返す", async () => {
    const app = buildApp();
    const res = await app.request(`/${DID}/${RKEY}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expectPageHeaders(res);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    // 固定のページタイトル・OGP（要件6.7）。
    expect(body).toContain("<title>ネタバレ投稿</title>");
    expect(body).toContain('property="og:title" content="ネタバレ投稿"');
    expect(body).toContain('property="og:description" content="ネタバレを含む投稿です。"');
    expect(body).toContain('name="robots" content="noindex, nosnippet, noarchive"');

    // クライアントJSが読むプレースホルダのdata属性。
    expect(body).toContain(`data-post-did="${DID}"`);
    expect(body).toContain(`data-post-rkey="${RKEY}"`);

    // SSR判定中に取得した本文・投稿者情報は破棄され、初期HTMLに含まれない
    // （要件6.7・受入基準11、screens.md 3.4）。
    expect(body).not.toContain("ネタバレ本文");
    expect(body).not.toContain("Alice");
    expect(body).not.toContain("alice.example.com");
    expect(body).toContain('src="/assets/js/post.js"');

    // フッターの規約リンク（要件6.10）。
    expect(body).toContain('href="/terms"');
    expect(body).toContain('href="/privacy"');
  });

  it("DID構文が不正なら404固定メッセージ（レコード取得しない）", async () => {
    const getSpoiler = vi.fn(async () => sampleResult);
    const app = buildApp({ content: contentStub(getSpoiler) });
    const res = await app.request(`/did:key:z6Mk/${RKEY}`);
    const body = await res.text();

    expect(res.status).toBe(404);
    expectPageHeaders(res);
    expect(body).toContain("この投稿は表示できません。");
    expect(body).not.toContain("data-post-did");
    expect(getSpoiler).not.toHaveBeenCalled();
  });

  it("rkey構文が不正なら404固定メッセージ", async () => {
    const app = buildApp();
    const res = await app.request(`/${DID}/bad%20key`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("この投稿は表示できません。");
  });

  it("表示停止対象は404固定メッセージ（レコード取得前に判定）", async () => {
    const denylist = denylistStub(true);
    const getSpoiler = vi.fn(async () => sampleResult);
    const app = buildApp({ denylist, content: contentStub(getSpoiler) });
    const res = await app.request(`/${DID}/${RKEY}`);

    expect(res.status).toBe(404);
    expect(await res.text()).toContain("この投稿は表示できません。");
    expect(denylist.isDenied).toHaveBeenCalledWith(DID, RKEY);
    expect(getSpoiler).not.toHaveBeenCalled();
  });

  it("レコードが存在しない・形式不正・DID解決失敗（getSpoilerがnull）なら404", async () => {
    const app = buildApp({ content: contentStub(async () => null) });
    const res = await app.request(`/${DID}/${RKEY}`);
    const body = await res.text();

    expect(res.status).toBe(404);
    expectPageHeaders(res);
    expect(body).toContain("この投稿は表示できません。");
    expect(body).not.toContain("data-post-did");
  });

  it("判定中に例外が発生しても404（理由を漏らさない）", async () => {
    const app = buildApp({
      content: contentStub(async () => {
        throw new Error("boom");
      }),
    });
    const res = await app.request(`/${DID}/${RKEY}`);

    expect(res.status).toBe(404);
    expect(await res.text()).toContain("この投稿は表示できません。");
  });

  it("構文不正・表示停止・不存在のいずれも同一の固定メッセージで理由を区別しない", async () => {
    const invalidBody = await (await buildApp().request(`/not-a-did/${RKEY}`)).text();
    const deniedBody = await (
      await buildApp({ denylist: denylistStub(true) }).request(`/${DID}/${RKEY}`)
    ).text();
    const missingBody = await (
      await buildApp({ content: contentStub(async () => null) }).request(`/${DID}/${RKEY}`)
    ).text();

    expect(invalidBody).toBe(deniedBody);
    expect(deniedBody).toBe(missingBody);
  });
});
