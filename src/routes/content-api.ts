import type { Context } from "hono";
import { Hono } from "hono";
import type { Config } from "../config/index.js";
import { isValidRecordKey, parseDid } from "../lib/atproto-syntax.js";
import type { ContentService } from "../services/content.js";
import { createContentService } from "../services/content.js";
import type { DenylistService } from "../services/denylist.js";
import { createDenylistService } from "../services/denylist.js";
import type { DidResolver } from "../services/did.js";
import { createDidResolver } from "../services/did.js";
import { createHandleResolver } from "../services/handle.js";
import type { AppEnv } from "../types.js";

/**
 * 本文取得API `GET /api/p/{did}/{rkey}`（content-api.md）。
 *
 * Honoのサブアプリとしてexportする。統括者が `/api/p` にマウントする想定
 * （マウント後のパスは `/api/p/:did/:rkey`）。
 *
 * 処理フロー: 入力検証 → 表示停止判定 → DID解決 → レコード取得 → 形式検証 →
 * 投稿者情報取得 → 返却。表示できない理由は区別せず一律404 `{error:"unavailable"}`。
 */

export interface ContentApiDeps {
  denylist: DenylistService;
  content: ContentService;
}

function setResponseHeaders(c: Context<AppEnv>): void {
  // 200・404共通（content-api.md 1.）。X-Content-Type-Options はグローバルの
  // securityHeaders でも付与されるが、本APIの独立性のため明示的にも設定する。
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Robots-Tag", "noindex, nosnippet, noarchive");
}

function unavailable(c: Context<AppEnv>): Response {
  return c.json({ error: "unavailable" }, 404);
}

export function createContentApiRoutes(deps: ContentApiDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    await next();
    setResponseHeaders(c);
  });

  app.get("/:did/:rkey", async (c) => {
    const parsed = parseDid(c.req.param("did"));
    const rkey = c.req.param("rkey");

    // 入力検証（content-api.md 2. ステップ1）。
    if (parsed === null || !isValidRecordKey(rkey)) {
      return unavailable(c);
    }

    // 表示停止判定（レコード取得より前。content-api.md 2. ステップ2）。
    if (deps.denylist.isDenied(parsed.did, rkey)) {
      return unavailable(c);
    }

    let result: Awaited<ReturnType<ContentService["getSpoiler"]>>;
    try {
      result = await deps.content.getSpoiler(parsed, rkey);
    } catch {
      // 内部エラーも理由を区別せず404にする（本文・例外の生値はログに出さない）。
      return unavailable(c);
    }
    if (result === null) {
      return unavailable(c);
    }
    return c.json(result, 200);
  });

  return app;
}

export interface ContentApi {
  /** `/api/p` にマウントするサブアプリ */
  routes: Hono<AppEnv>;
  /** 表示停止リストサービス（Phase 3b の /p ページでも再利用する） */
  denylist: DenylistService;
  /**
   * 本文取得サービス。/p ページのSSR表示可否判定でも同じ実装を共有する
   * （screens.md 3.4「本文取得APIと同じ表示可否判定（実装を共有する）」）。
   */
  content: ContentService;
  /** 表示停止リストの定期再読み込みタイマーを停止する。 */
  stop(): void;
}

export interface CreateContentApiOptions {
  /**
   * DID解決器。PDS読み取りサービス（pds-read）とキャッシュを一本化するため、
   * 統括者が生成した共有インスタンスを注入できる。未指定なら内部生成する。
   */
  didResolver?: DidResolver;
}

/**
 * 本文取得APIの依存一式（DID解決・ハンドル解決・本文サービス・表示停止リスト）を
 * 組み立てて返す統合ファクトリ。統括者はこれ1つを呼び、`routes` をマウントし、
 * `denylist`・`content` を /p ページと共有すればよい。
 * `didResolver` を渡すと、PDS読み取りサービスと解決結果キャッシュを共有できる。
 */
export function createContentApi(
  config: Config,
  options: CreateContentApiOptions = {},
): ContentApi {
  const denylist = createDenylistService(config.denylistPath);
  const didResolver = options.didResolver ?? createDidResolver();
  const handleResolver = createHandleResolver();
  const content = createContentService({ didResolver, handleResolver });
  const routes = createContentApiRoutes({ denylist, content });

  return {
    routes,
    denylist,
    content,
    stop(): void {
      denylist.stop();
    },
  };
}
