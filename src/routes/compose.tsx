import type { Agent } from "@atproto/api";
import { Hono } from "hono";
import { buildAnnouncementUrl } from "../lib/at-uri.js";
import { isValidRecordKey } from "../lib/atproto-syntax.js";
import { requireAuth } from "../middleware/auth.js";
import { csrfProtection, generateCsrfToken } from "../middleware/csrf.js";
import { validateSpoilerRecord } from "../services/content.js";
import { getAgentForDid, SessionRevokedError } from "../services/oauth.js";
import type { PdsReader } from "../services/pds-read.js";
import { createPdsReader } from "../services/pds-read.js";
import {
  buildDedicatedUrl,
  createSpoilerPost,
  SPOILER_COLLECTION,
  SpoilerPostWriteError,
  validateComposeText,
} from "../services/spoiler-post.js";
import type { AppEnv } from "../types.js";
import { ComposeDone } from "../views/compose-done.js";
import { ComposeForm } from "../views/compose-form.js";

/**
 * 投稿作成（`GET /compose`・`POST /compose`・`GET /compose/done/:rkey`。screens.md 3.2・3.3・4.1）。
 *
 * 自己完結のHonoサブアプリを返すファクトリ。統括者が `app.route("/", ...)` で
 * app.tsx に配線する想定（このファイル内で requireAuth・csrfProtection を都度 use する）。
 * 投稿完了画面のレコード取得は認証なしの {@link PdsReader} 経由で行う（書き込みのみ
 * 認証付きAgentを使う。oauth-session.md 2.）。
 */

export interface ComposeRoutesDeps {
  /** 投稿完了画面のレコード取得に使う認証なし読み取り。未指定なら既定を生成する。 */
  reader?: PdsReader;
}

const COMPOSE_TITLE = "投稿";
const COMPOSE_DONE_TITLE = "投稿完了";
const NOT_FOUND_MESSAGE = "指定された投稿が見つかりません。";

export function createComposeRoutes(deps: ComposeRoutesDeps = {}): Hono<AppEnv> {
  const reader = deps.reader ?? createPdsReader();
  const composeRoute = new Hono<AppEnv>();

  // 検証エラー・書き込み失敗時の再表示は入力された本文をエコーバックするため、
  // ブラウザ・中間経路にキャッシュさせない（要件7.2の非キャッシュ方針）。
  composeRoute.use("/compose", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  composeRoute.use("/compose/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  composeRoute.get("/compose", requireAuth(), (c) => {
    const session = c.get("session");
    const csrfToken = generateCsrfToken(session.csrfSecret);
    return c.render(<ComposeForm csrfToken={csrfToken} />, { title: COMPOSE_TITLE });
  });

  composeRoute.post("/compose", requireAuth(), csrfProtection(), async (c) => {
    const session = c.get("session");
    const body = await c.req.parseBody();
    const text = typeof body.text === "string" ? body.text : "";

    const validationError = validateComposeText(text);
    if (validationError) {
      const csrfToken = generateCsrfToken(session.csrfSecret);
      return c.render(<ComposeForm csrfToken={csrfToken} text={text} error={validationError} />, {
        title: COMPOSE_TITLE,
      });
    }

    let agent: Agent;
    try {
      agent = await getAgentForDid(c.get("oauthClient"), c.get("db"), session.did);
    } catch (err) {
      if (err instanceof SessionRevokedError) {
        return c.redirect("/", 302);
      }
      throw err;
    }

    try {
      const result = await createSpoilerPost(agent, c.get("config").origin, session.did, text);
      // PRG（Post/Redirect/Get）。リロードによる二重投稿を防ぐ（screens.md 1.）。
      return c.redirect(`/compose/done/${result.rkeyPost}`, 303);
    } catch (err) {
      if (err instanceof SpoilerPostWriteError) {
        const csrfToken = generateCsrfToken(session.csrfSecret);
        return c.render(<ComposeForm csrfToken={csrfToken} text={text} error="write-failed" />, {
          title: COMPOSE_TITLE,
        });
      }
      throw err;
    }
  });

  composeRoute.get("/compose/done/:rkey", requireAuth(), async (c) => {
    const session = c.get("session");
    const rkey = c.req.param("rkey");
    if (!isValidRecordKey(rkey)) {
      return c.text(NOT_FOUND_MESSAGE, 404);
    }

    // announcementRkey はセッションのDIDで本文レコードを取得して得る（screens.md 3.3）。
    // 読み取りは認証なしの公開XRPC経由（oauth-session.md 2.）。
    let recordValue: unknown;
    try {
      recordValue = await reader.getRecord(session.did, SPOILER_COLLECTION, rkey);
    } catch {
      return c.text(NOT_FOUND_MESSAGE, 404);
    }

    const validated = validateSpoilerRecord(recordValue);
    if (!validated) {
      return c.text(NOT_FOUND_MESSAGE, 404);
    }

    const origin = c.get("config").origin;
    const dedicatedUrl = buildDedicatedUrl(origin, session.did, rkey);
    const announcementUrl = buildAnnouncementUrl(session.did, validated.announcementRkey);

    return c.render(<ComposeDone dedicatedUrl={dedicatedUrl} announcementUrl={announcementUrl} />, {
      title: COMPOSE_DONE_TITLE,
    });
  });

  return composeRoute;
}

export const composeRoute = createComposeRoutes();
