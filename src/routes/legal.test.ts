import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import type { HtmlEscapedString } from "hono/utils/html";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../types.js";
import { Layout } from "../views/layout.js";
import { legalRoute } from "./legal.js"; // legal.tsx から export

function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(
    "*",
    jsxRenderer(({ children, title }) =>
      Layout({ title, children: children as unknown as HtmlEscapedString }),
    ),
  );
  app.route("/", legalRoute);
  return app;
}

describe("legal routes", () => {
  const app = buildApp();

  describe("GET /terms", () => {
    it("returns 200 with Terms of Service", async () => {
      const res = await app.request("/terms");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("<title>利用規約 - skyseal</title>");
      expect(html).toContain("利用規約");
      expect(html).toContain("第1条");
      expect(html).toContain("第2条");
      expect(html).toContain("第3条");
      expect(html).toContain("第4条");
      expect(html).toContain("第5条");
      expect(html).toContain("第6条");
      expect(html).toContain("第7条");
      expect(html).toContain("第8条");
      expect(html).toContain("第9条");
      expect(html).toContain("第10条");
      expect(html).toContain("第11条");
    });

    it("includes required content from MVP requirements 6.10", async () => {
      const res = await app.request("/terms");
      const html = await res.text();
      // 必須項目：データ範囲・PDS公開データ・表示停止根拠・連絡手段
      expect(html).toContain("投稿データの取り扱い");
      expect(html).toContain("公開データ");
      expect(html).toContain("表示停止");
      expect(html).toContain("連絡手段");
    });

    it("displays placeholders as prepared message", async () => {
      const res = await app.request("/terms");
      const html = await res.text();
      // プレースホルダは「（準備中）」として表示
      expect(html).toContain("（準備中）");
    });
  });

  describe("GET /privacy", () => {
    it("returns 200 with Privacy Policy", async () => {
      const res = await app.request("/privacy");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("<title>プライバシーポリシー - skyseal</title>");
      expect(html).toContain("プライバシーポリシー");
      expect(html).toContain("取得・保存する情報");
      expect(html).toContain("保存しない情報");
      expect(html).toContain("利用目的");
      expect(html).toContain("第三者提供");
      expect(html).toContain("問い合わせ");
    });

    it("includes required content from MVP requirements 6.10", async () => {
      const res = await app.request("/privacy");
      const html = await res.text();
      // 必須項目：データ範囲・本文が投稿者PDS上の公開データであること・連絡手段
      expect(html).toContain("取得・保存する情報");
      expect(html).toContain("投稿本文を本サービス側に恒久保存しません");
      expect(html).toContain("公開データ");
      expect(html).toContain("問い合わせ");
    });

    it("displays placeholders as prepared message", async () => {
      const res = await app.request("/privacy");
      const html = await res.text();
      // プレースホルダは「（準備中）」として表示
      expect(html).toContain("（準備中）");
    });

    it("includes table styling container", async () => {
      const res = await app.request("/privacy");
      const html = await res.text();
      expect(html).toContain("table-container");
      expect(html).toContain("<table>");
      expect(html).toContain("OAuthセッション情報");
      expect(html).toContain("セッションCookie");
    });
  });
});
