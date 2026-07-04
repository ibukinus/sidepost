import { Hono } from "hono";
import { getAppSession, readSessionCookie } from "../services/session.js";
import type { AppEnv } from "../types.js";
import { Login } from "../views/login.js";

/**
 * GET /（ログイン画面。screens.md 3.1）。
 * ログイン済み（有効なアプリセッションを持つ）なら投稿画面 `/compose` へリダイレクトする。
 */
export const homeRoute = new Hono<AppEnv>();

homeRoute.get("/", (c) => {
  const sessionId = readSessionCookie(c);
  if (sessionId && getAppSession(c.get("db"), sessionId)) {
    return c.redirect("/compose", 302);
  }
  return c.render(<Login />, { title: "ログイン" });
});
