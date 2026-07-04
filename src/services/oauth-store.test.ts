import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/index.js";
import {
  createSessionStore,
  createStateStore,
  deleteExpiredStates,
  deleteOAuthSession,
  OAUTH_STATE_TTL_MS,
} from "./oauth-store.js";

// NodeSavedState / NodeSavedSession はJSON化可能な任意オブジェクト。
// ストアの型はライブラリのブランド型を要求するため、テストでは最小のダミーを注入する。
// biome-ignore lint/suspicious/noExplicitAny: テスト用のダミー値
const dummyState = { iss: "https://pds.example", verifier: "v", dpopJwk: { kty: "EC" } } as any;
// biome-ignore lint/suspicious/noExplicitAny: テスト用のダミー値
const dummySession = { tokenSet: { access_token: "at", sub: "did:plc:abc" }, dpopJwk: {} } as any;

describe("oauth-store", () => {
  let db: Database.Database;
  const key = randomBytes(32);

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  describe("stateStore", () => {
    it("set→get→del が機能する", () => {
      const store = createStateStore(db, key);
      store.set("state-1", dummyState);
      expect(store.get("state-1")).toEqual(dummyState);
      store.del("state-1");
      expect(store.get("state-1")).toBeUndefined();
    });

    it("保存値は暗号化される（平文がDBに現れない）", () => {
      const store = createStateStore(db, key);
      store.set("state-1", dummyState);
      const row = db
        .prepare("SELECT state_data FROM oauth_state WHERE state_key = ?")
        .get("state-1") as {
        state_data: string;
      };
      expect(row.state_data).not.toContain("pds.example");
    });

    it("TTLを過ぎたstateはgetでundefinedになり削除される", () => {
      const store = createStateStore(db, key);
      store.set("state-1", dummyState);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + OAUTH_STATE_TTL_MS + 1000);
      expect(store.get("state-1")).toBeUndefined();
      const count = db.prepare("SELECT COUNT(*) AS n FROM oauth_state").get() as { n: number };
      expect(count.n).toBe(0);
    });

    it("deleteExpiredStates は期限切れのみ削除する", () => {
      const store = createStateStore(db, key);
      store.set("old", dummyState);
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + OAUTH_STATE_TTL_MS + 1000);
      store.set("fresh", dummyState);
      deleteExpiredStates(db);
      const count = db.prepare("SELECT COUNT(*) AS n FROM oauth_state").get() as { n: number };
      expect(count.n).toBe(1);
    });
  });

  describe("sessionStore", () => {
    it("set→get→del が機能する", () => {
      const store = createSessionStore(db, key);
      store.set("did:plc:abc", dummySession);
      expect(store.get("did:plc:abc")).toEqual(dummySession);
      store.del("did:plc:abc");
      expect(store.get("did:plc:abc")).toBeUndefined();
    });

    it("保存値は暗号化される（トークンがDBに現れない）", () => {
      const store = createSessionStore(db, key);
      store.set("did:plc:abc", dummySession);
      const row = db
        .prepare("SELECT session_data FROM oauth_session WHERE did = ?")
        .get("did:plc:abc") as {
        session_data: string;
      };
      expect(row.session_data).not.toContain("access_token");
    });

    it("deleteOAuthSession で削除できる", () => {
      const store = createSessionStore(db, key);
      store.set("did:plc:abc", dummySession);
      deleteOAuthSession(db, "did:plc:abc");
      expect(store.get("did:plc:abc")).toBeUndefined();
    });
  });
});
