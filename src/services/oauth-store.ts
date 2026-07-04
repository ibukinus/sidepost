import type {
  NodeSavedSession,
  NodeSavedSessionStore,
  NodeSavedState,
  NodeSavedStateStore,
} from "@atproto/oauth-client-node";
import type Database from "better-sqlite3";
import { decryptFromBase64, encryptToBase64 } from "./oauth-crypto.js";

/**
 * `@atproto/oauth-client-node` のセッション/stateストアをSQLite上に実装する
 * （oauth-session.md 3.・4.、architecture.md 4.）。
 *
 * - 保存値（トークン・DPoP鍵・PKCE verifier等）は `SKYSEAL_ENCRYPTION_KEY` による
 *   AES-256-GCMで暗号化してから格納する。平文はDBにもログにも残さない。
 * - `oauth_state` は認可フロー中の一時データであり、短TTL（既定10分）で失効させる。
 *   期限切れ行は `get` 時と定期ジョブ（`deleteExpiredStates`）の双方で削除する。
 */

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface StateRow {
  state_data: string;
  created_at: number;
}

interface SessionRow {
  session_data: string;
}

export function createStateStore(
  db: Database.Database,
  encryptionKey: Buffer,
): NodeSavedStateStore {
  const upsert = db.prepare(
    `INSERT INTO oauth_state (state_key, state_data, created_at) VALUES (?, ?, ?)
     ON CONFLICT(state_key) DO UPDATE SET state_data = excluded.state_data, created_at = excluded.created_at`,
  );
  const select = db.prepare("SELECT state_data, created_at FROM oauth_state WHERE state_key = ?");
  const remove = db.prepare("DELETE FROM oauth_state WHERE state_key = ?");

  return {
    get(key: string): NodeSavedState | undefined {
      const row = select.get(key) as StateRow | undefined;
      if (!row) {
        return undefined;
      }
      if (Date.now() - row.created_at > OAUTH_STATE_TTL_MS) {
        remove.run(key);
        return undefined;
      }
      return JSON.parse(decryptFromBase64(row.state_data, encryptionKey)) as NodeSavedState;
    },
    set(key: string, value: NodeSavedState): void {
      upsert.run(key, encryptToBase64(JSON.stringify(value), encryptionKey), Date.now());
    },
    del(key: string): void {
      remove.run(key);
    },
  };
}

export function createSessionStore(
  db: Database.Database,
  encryptionKey: Buffer,
): NodeSavedSessionStore {
  const upsert = db.prepare(
    `INSERT INTO oauth_session (did, session_data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(did) DO UPDATE SET session_data = excluded.session_data, updated_at = excluded.updated_at`,
  );
  const select = db.prepare("SELECT session_data FROM oauth_session WHERE did = ?");
  const remove = db.prepare("DELETE FROM oauth_session WHERE did = ?");

  return {
    get(did: string): NodeSavedSession | undefined {
      const row = select.get(did) as SessionRow | undefined;
      if (!row) {
        return undefined;
      }
      return JSON.parse(decryptFromBase64(row.session_data, encryptionKey)) as NodeSavedSession;
    },
    set(did: string, value: NodeSavedSession): void {
      upsert.run(did, encryptToBase64(JSON.stringify(value), encryptionKey), Date.now());
    },
    del(did: string): void {
      remove.run(did);
    },
  };
}

/** 認可フロー中の期限切れstateを削除する（定期ジョブ用）。 */
export function deleteExpiredStates(db: Database.Database): void {
  db.prepare("DELETE FROM oauth_state WHERE created_at < ?").run(Date.now() - OAUTH_STATE_TTL_MS);
}

/** ログアウト・失効時にOAuthセッションを確実に削除するための直接削除。 */
export function deleteOAuthSession(db: Database.Database, did: string): void {
  db.prepare("DELETE FROM oauth_session WHERE did = ?").run(did);
}
