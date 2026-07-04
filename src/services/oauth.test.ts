import type { NodeOAuthClient } from "@atproto/oauth-client-node";
import {
  OAuthCallbackError,
  OAuthResolverError,
  OAuthResponseError,
  TokenRevokedError,
} from "@atproto/oauth-client-node";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/index.js";
import { classifyLoginError, getAgentForDid, SessionRevokedError } from "./oauth.js";
import { createSessionStore } from "./oauth-store.js";
import { createAppSession, getAppSession } from "./session.js";

function responseError(code: string): OAuthResponseError {
  return new OAuthResponseError(new Response(null, { status: 400 }), { error: code });
}

describe("classifyLoginError", () => {
  it("invalid_scope を granular-scope-unsupported に分類する", () => {
    expect(classifyLoginError(responseError("invalid_scope"))).toBe("granular-scope-unsupported");
  });

  it("cause連鎖の中の invalid_scope も検出する", () => {
    const wrapped = new Error("wrapper", { cause: responseError("invalid_scope") });
    expect(classifyLoginError(wrapped)).toBe("granular-scope-unsupported");
  });

  it("callbackの error=access_denied を denied に分類する", () => {
    const err = new OAuthCallbackError(new URLSearchParams({ error: "access_denied" }));
    expect(classifyLoginError(err)).toBe("denied");
  });

  it("callbackの error=invalid_scope も granular-scope-unsupported に分類する", () => {
    const err = new OAuthCallbackError(new URLSearchParams({ error: "invalid_scope" }));
    expect(classifyLoginError(err)).toBe("granular-scope-unsupported");
  });

  it("OAuthResolverError を handle-resolution に分類する", () => {
    expect(classifyLoginError(new OAuthResolverError("解決失敗"))).toBe("handle-resolution");
  });

  it("それ以外は unknown", () => {
    expect(classifyLoginError(new Error("boom"))).toBe("unknown");
    expect(classifyLoginError(responseError("server_error"))).toBe("unknown");
  });
});

describe("getAgentForDid", () => {
  let db: Database.Database;
  const key = Buffer.alloc(32, 3);

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("トークン取り消し検知でセッションを削除し SessionRevokedError を投げる", async () => {
    const did = "did:plc:abc";
    // OAuthセッションとアプリセッションを用意する。
    const sessionStore = createSessionStore(db, key);
    // biome-ignore lint/suspicious/noExplicitAny: テスト用ダミー
    sessionStore.set(did, { tokenSet: { sub: did }, dpopJwk: {} } as any);
    const appSession = createAppSession(db, did);

    const fakeClient = {
      restore: () => {
        throw new TokenRevokedError(did);
      },
    } as unknown as NodeOAuthClient;

    await expect(getAgentForDid(fakeClient, db, did)).rejects.toBeInstanceOf(SessionRevokedError);

    // 該当DIDのOAuthセッション・アプリセッションが削除されている。
    expect(getAppSession(db, appSession.sessionId)).toBeUndefined();
    const count = db.prepare("SELECT COUNT(*) AS n FROM oauth_session WHERE did = ?").get(did) as {
      n: number;
    };
    expect(count.n).toBe(0);
  });
});
