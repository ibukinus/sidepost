import { ComAtprotoRepoApplyWrites, XRPCError } from "@atproto/api";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/index.js";
import { CSRF_FIELD_NAME, generateCsrfToken } from "../middleware/csrf.js";
import type { RepoWriter } from "../services/manage.js";
import { SessionRevokedError } from "../services/oauth.js";
import type { PdsReader } from "../services/pds-read.js";
import { PdsRecordNotFoundError } from "../services/pds-read.js";
import { createAppSession, SESSION_COOKIE_NAME } from "../services/session.js";
import type { AppEnv } from "../types.js";
import { Layout } from "../views/layout.js";
import type { ManageRoutesDeps } from "./manage.js";
import { createManageRoutes } from "./manage.js";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const ORIGIN = "https://skyseal.example.com";

function invalidSwap(): ComAtprotoRepoApplyWrites.InvalidSwapError {
  return new ComAtprotoRepoApplyWrites.InvalidSwapError(
    new XRPCError(409, "InvalidSwap", "Commit was too old"),
  );
}

/** 認証なし読み取り（PdsReader）のフェイク。既定は空一覧・レコード不在。 */
function fakeReader(overrides: Partial<PdsReader> = {}): PdsReader {
  return {
    listRecords: vi.fn().mockResolvedValue({ records: [] }),
    getRecord: vi.fn().mockRejectedValue(new PdsRecordNotFoundError()),
    getLatestCommit: vi.fn().mockResolvedValue({ cid: "bafycommit", rev: "1" }),
    ...overrides,
  };
}

/** 認証付き書き込み（RepoWriter）のフェイク。 */
function fakeWriter(overrides: Partial<RepoWriter> = {}): RepoWriter {
  return {
    applyWrites: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("manage routes", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function buildApp(deps: ManageRoutesDeps) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("config", { origin: ORIGIN } as AppEnv["Variables"]["config"]);
      c.set("oauthClient", {} as never);
      await next();
    });
    app.use(
      "*",
      jsxRenderer(({ children, title }) => <Layout title={title}>{children}</Layout>),
    );
    app.route("/", createManageRoutes(deps));
    return app;
  }

  function loginCookie() {
    const session = createAppSession(db, DID);
    return { session, header: { cookie: `${SESSION_COOKIE_NAME}=${session.sessionId}` } };
  }

  describe("GET /manage", () => {
    it("未ログインは / へリダイレクトする", async () => {
      const app = buildApp({ reader: fakeReader(), getWriter: vi.fn() });
      const res = await app.request("/manage");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });

    it("一覧を200で描画する（認証なしreaderのlistRecordsを使う）", async () => {
      const { header } = loginCookie();
      const listRecords = vi.fn().mockResolvedValue({
        records: [
          {
            uri: `at://${DID}/jp.mp0.skyseal.post/rkey1`,
            cid: "cid1",
            value: {
              $type: "jp.mp0.skyseal.post",
              text: "本文の一部",
              createdAt: "2026-07-01T00:00:00.000Z",
              announcementRkey: "announce1",
            },
          },
        ],
      });
      const getWriter = vi.fn();
      const app = buildApp({ reader: fakeReader({ listRecords }), getWriter });

      const res = await app.request("/manage", { headers: header });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("本文の一部");
      expect(html).toContain(`/p/${DID}/rkey1`);
      // 一覧はセッションのDIDで、認証なしreader経由。
      expect(listRecords).toHaveBeenCalledWith(DID, "jp.mp0.skyseal.post", {
        limit: 50,
        reverse: true,
      });
      // 読み取りに認証付きAgentは取得しない。
      expect(getWriter).not.toHaveBeenCalled();
    });

    it("一覧取得に失敗したら明確なエラー文言を表示する（本文は含めない）", async () => {
      const { header } = loginCookie();
      const listRecords = vi.fn().mockRejectedValue(new Error("boom"));
      const app = buildApp({ reader: fakeReader({ listRecords }), getWriter: vi.fn() });

      const res = await app.request("/manage", { headers: header });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("投稿一覧を取得できませんでした");
    });
  });

  describe("POST /manage/delete", () => {
    function spoilerRecordValue() {
      return {
        $type: "jp.mp0.skyseal.post",
        text: "本文",
        createdAt: "2026-07-01T00:00:00.000Z",
        announcementRkey: "announce1",
      };
    }

    it("CSRFトークンが無ければ403を返す", async () => {
      const { header } = loginCookie();
      const app = buildApp({ reader: fakeReader(), getWriter: vi.fn() });

      const res = await app.request("/manage/delete", {
        method: "POST",
        headers: { ...header, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ rkey: "rkey1" }),
      });

      expect(res.status).toBe(403);
    });

    it("成功時は303で /manage/deleted へPRGする", async () => {
      const { session, header } = loginCookie();
      const getRecord = vi
        .fn()
        .mockResolvedValueOnce(spoilerRecordValue())
        .mockRejectedValueOnce(new PdsRecordNotFoundError());
      const applyWrites = vi.fn().mockResolvedValue(undefined);
      const app = buildApp({
        reader: fakeReader({ getRecord }),
        getWriter: vi.fn().mockResolvedValue(fakeWriter({ applyWrites })),
      });
      const token = generateCsrfToken(session.csrfSecret);

      const res = await app.request("/manage/delete", {
        method: "POST",
        headers: { ...header, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ rkey: "rkey1", [CSRF_FIELD_NAME]: token }),
        redirect: "manual",
      });

      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/manage/deleted");
    });

    it("自分のDIDのリポジトリのみを操作する（リクエストにDIDフィールドがあっても無視する）", async () => {
      const { session, header } = loginCookie();
      const getRecord = vi
        .fn()
        .mockResolvedValueOnce(spoilerRecordValue())
        .mockRejectedValueOnce(new PdsRecordNotFoundError());
      const applyWrites = vi.fn().mockResolvedValue(undefined);
      const getWriter = vi.fn().mockResolvedValue(fakeWriter({ applyWrites }));
      const app = buildApp({ reader: fakeReader({ getRecord }), getWriter });
      const token = generateCsrfToken(session.csrfSecret);

      await app.request("/manage/delete", {
        method: "POST",
        headers: { ...header, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          rkey: "rkey1",
          did: "did:plc:attackerattackerattacker",
          [CSRF_FIELD_NAME]: token,
        }),
        redirect: "manual",
      });

      // 書き込み用AgentはセッションのDIDでのみ取得する。
      expect(getWriter).toHaveBeenCalledWith(expect.anything(), db, DID);
      // 読み取りもセッションのDIDに対して認証なしで行う。
      expect(getRecord).toHaveBeenCalledWith(DID, "jp.mp0.skyseal.post", "rkey1");
      expect(applyWrites).toHaveBeenCalledWith(expect.objectContaining({ repo: DID }));
    });

    it("不正なrkeyは一覧画面へ明確なエラーとともに戻す", async () => {
      const { session, header } = loginCookie();
      const getRecord = vi.fn();
      const app = buildApp({
        reader: fakeReader({ getRecord }),
        getWriter: vi.fn().mockResolvedValue(fakeWriter()),
      });
      const token = generateCsrfToken(session.csrfSecret);

      const res = await app.request("/manage/delete", {
        method: "POST",
        headers: { ...header, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ rkey: "bad rkey", [CSRF_FIELD_NAME]: token }),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("すでに削除されている可能性があります");
      expect(getRecord).not.toHaveBeenCalled();
    });

    it("swap競合時は一覧画面へ明確なエラーとともに戻す（自動リトライしない）", async () => {
      const { session, header } = loginCookie();
      const getRecord = vi
        .fn()
        .mockResolvedValueOnce(spoilerRecordValue())
        .mockRejectedValueOnce(new PdsRecordNotFoundError());
      const applyWrites = vi.fn().mockRejectedValue(invalidSwap());
      const app = buildApp({
        reader: fakeReader({ getRecord }),
        getWriter: vi.fn().mockResolvedValue(fakeWriter({ applyWrites })),
      });
      const token = generateCsrfToken(session.csrfSecret);

      const res = await app.request("/manage/delete", {
        method: "POST",
        headers: { ...header, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ rkey: "rkey1", [CSRF_FIELD_NAME]: token }),
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("他の操作と競合したため削除できませんでした");
    });

    it("SessionRevokedError（書き込みAgent取得時）なら / へリダイレクトする", async () => {
      const { session, header } = loginCookie();
      const getWriter = vi.fn().mockRejectedValue(new SessionRevokedError());
      const app = buildApp({ reader: fakeReader(), getWriter });
      const token = generateCsrfToken(session.csrfSecret);

      const res = await app.request("/manage/delete", {
        method: "POST",
        headers: { ...header, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ rkey: "rkey1", [CSRF_FIELD_NAME]: token }),
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });
  });

  describe("GET /manage/deleted", () => {
    it("未ログインは / へリダイレクトする", async () => {
      const app = buildApp({ reader: fakeReader(), getWriter: vi.fn() });
      const res = await app.request("/manage/deleted");
      expect(res.status).toBe(302);
    });

    it("ログイン済みなら固定の削除完了文言を表示する", async () => {
      const { header } = loginCookie();
      const app = buildApp({ reader: fakeReader(), getWriter: vi.fn() });

      const res = await app.request("/manage/deleted", { headers: header });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("削除が完了しました");
    });
  });
});
