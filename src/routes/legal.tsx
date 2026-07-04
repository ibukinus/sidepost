import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { Privacy } from "../views/privacy.js";
import { Terms } from "../views/terms.js";

/**
 * 利用規約・プライバシーポリシー静的ページ（screens.md 3.7）。
 * - GET /terms 利用規約
 * - GET /privacy プライバシーポリシー
 * 認証不要。
 */
export const legalRoute = new Hono<AppEnv>();

legalRoute.get("/terms", (c) => {
  return c.render(<Terms />, { title: "利用規約" });
});

legalRoute.get("/privacy", (c) => {
  return c.render(<Privacy />, { title: "プライバシーポリシー" });
});
