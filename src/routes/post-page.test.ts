import { describe, expect, it, vi } from "vitest";
import type { DenylistService } from "../services/denylist.js";
import { createPostPageRoute } from "./post-page.js";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const RKEY = "3juf5s2xku2v";

function denylistStub(denied = false): DenylistService {
  return {
    isDenied: vi.fn().mockReturnValue(denied),
    reload: vi.fn(),
    stop: vi.fn(),
  };
}

function expectPageHeaders(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nosnippet, noarchive");
}

describe("post-page route (GET /p/{did}/{rkey})", () => {
  it("正しいDID・rkeyなら200を返し、本文を含まない初期HTMLを返す", async () => {
    const app = createPostPageRoute(denylistStub());
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

    // 本文・投稿者情報を一切含まない（架空の値だが、テキストノードとして存在しないことを確認）。
    expect(body).not.toContain("ネタバレ本文");
    expect(body).toContain('src="/assets/js/post.js"');

    // フッターの規約リンク（要件6.10）。
    expect(body).toContain('href="/terms"');
    expect(body).toContain('href="/privacy"');
  });

  it("DID構文が不正なら404固定メッセージ", async () => {
    const app = createPostPageRoute(denylistStub());
    const res = await app.request(`/did:key:z6Mk/${RKEY}`);
    const body = await res.text();

    expect(res.status).toBe(404);
    expectPageHeaders(res);
    expect(body).toContain("この投稿は表示できません。");
    expect(body).not.toContain("data-post-did");
  });

  it("rkey構文が不正なら404固定メッセージ", async () => {
    const app = createPostPageRoute(denylistStub());
    const res = await app.request(`/${DID}/bad%20key`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("この投稿は表示できません。");
  });

  it("表示停止対象は404固定メッセージ（理由を区別しない）", async () => {
    const denylist = denylistStub(true);
    const app = createPostPageRoute(denylist);
    const res = await app.request(`/${DID}/${RKEY}`);

    expect(res.status).toBe(404);
    expect(await res.text()).toContain("この投稿は表示できません。");
    expect(denylist.isDenied).toHaveBeenCalledWith(DID, RKEY);
  });

  it("不正・停止中のいずれも同一の固定メッセージで理由を区別しない", async () => {
    const invalidApp = createPostPageRoute(denylistStub());
    const deniedApp = createPostPageRoute(denylistStub(true));
    const invalidBody = await (await invalidApp.request(`/not-a-did/${RKEY}`)).text();
    const deniedBody = await (await deniedApp.request(`/${DID}/${RKEY}`)).text();
    expect(invalidBody).toBe(deniedBody);
  });
});
