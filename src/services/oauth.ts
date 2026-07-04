import { Agent } from "@atproto/api";
import {
  JoseKey,
  NodeOAuthClient,
  OAuthCallbackError,
  OAuthResolverError,
  OAuthResponseError,
  requestLocalLock,
  TokenInvalidError,
  TokenRefreshError,
  TokenRevokedError,
} from "@atproto/oauth-client-node";
import type Database from "better-sqlite3";
import type { Config } from "../config/index.js";
import { createOAuthFetch } from "./oauth-fetch.js";
import { createSessionStore, createStateStore, deleteOAuthSession } from "./oauth-store.js";
import { deleteAppSessionsByDid } from "./session.js";

/**
 * OAuthクライアント構築とセッション復元（oauth-session.md 1.〜3.、7.）。
 *
 * - confidential client / `private_key_jwt`（ES256）/ granular scope 固定。
 * - フォールバック禁止（AGENTS.md）: granular scope 非対応や認可拒否は明確なエラーとして扱い、
 *   広いスコープでの再試行は一切行わない。
 */

/**
 * 要求スコープ（固定）。oauth-session.md 2.。`action=update` / `blob:` / `rpc:` /
 * `transition:*` は要求しない。
 */
export const LOGIN_SCOPE =
  "atproto repo:jp.mp0.skyseal.post?action=create&action=delete repo:app.bsky.feed.post?action=create&action=delete";

export async function createOAuthClient(
  config: Config,
  db: Database.Database,
): Promise<NodeOAuthClient> {
  const keyset = await Promise.all(
    config.oauthPrivateKeys.map((jwk) => JoseKey.fromJWK({ ...jwk }, jwk.kid)),
  );

  const origin = config.origin;
  return new NodeOAuthClient({
    clientMetadata: {
      client_id: `${origin}/oauth/client-metadata.json`,
      client_name: "skyseal",
      client_uri: origin,
      redirect_uris: [`${origin}/oauth/callback`],
      scope: LOGIN_SCOPE,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "web",
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      dpop_bound_access_tokens: true,
      jwks_uri: `${origin}/oauth/jwks.json`,
    },
    keyset,
    stateStore: createStateStore(db, config.encryptionKey),
    sessionStore: createSessionStore(db, config.encryptionKey),
    fetch: createOAuthFetch(),
    // 単一プロセス運用のためのローカルロック（oauth-client-node の警告を回避）。
    requestLock: requestLocalLock,
  });
}

/**
 * ログイン失敗理由の分類。可能な範囲で区別し、ログイン画面のエラー表示に用いる。
 * - granular-scope-unsupported: PDSがコレクション単位スコープ非対応（invalid_scope）。
 * - denied: 認可サーバー上で利用者がログインを拒否（access_denied）。
 * - handle-resolution: ハンドル→DID→PDSの解決に失敗。
 * - unknown: 上記以外（ネットワーク・サーバーエラー等）。
 */
export type LoginErrorReason =
  | "handle-resolution"
  | "granular-scope-unsupported"
  | "denied"
  | "unknown";

function* errorChain(err: unknown): Generator<object> {
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = (current as { cause?: unknown }).cause;
  }
}

export function classifyLoginError(err: unknown): LoginErrorReason {
  let sawResolver = false;
  for (const node of errorChain(err)) {
    if (node instanceof OAuthResponseError) {
      if (node.error === "invalid_scope") {
        return "granular-scope-unsupported";
      }
      if (node.error === "access_denied") {
        return "denied";
      }
    }
    if (node instanceof OAuthCallbackError) {
      const errorParam = node.params.get("error");
      if (errorParam === "invalid_scope") {
        return "granular-scope-unsupported";
      }
      if (errorParam === "access_denied") {
        return "denied";
      }
    }
    if (node instanceof OAuthResolverError) {
      sawResolver = true;
    }
  }
  return sawResolver ? "handle-resolution" : "unknown";
}

/** OAuthセッションが失効・取り消しされ、再ログインが必要な状態を表す。 */
export class SessionRevokedError extends Error {
  constructor(message = "OAuthセッションが無効です。再ログインが必要です") {
    super(message);
    this.name = "SessionRevokedError";
  }
}

/**
 * DIDに対応するOAuthセッションを復元し、PDSへ書き込むための `Agent` を返す
 * （oauth-session.md 3.・7.）。後続フェーズ（投稿・削除）が使用する。
 *
 * トークンの取り消し・失効を検知した場合は、該当DIDのOAuthセッションとアプリセッションを
 * 削除したうえで `SessionRevokedError` を投げる（呼び出し側は再ログインを要求する）。
 */
export async function getAgentForDid(
  client: NodeOAuthClient,
  db: Database.Database,
  did: string,
): Promise<Agent> {
  try {
    const session = await client.restore(did);
    return new Agent(session);
  } catch (err) {
    if (
      err instanceof TokenRefreshError ||
      err instanceof TokenRevokedError ||
      err instanceof TokenInvalidError
    ) {
      deleteOAuthSession(db, did);
      deleteAppSessionsByDid(db, did);
      throw new SessionRevokedError();
    }
    throw err;
  }
}
