import Database from "better-sqlite3";

/**
 * SQLiteの初期化。architecture.md 4. に定めるテーブルのみを保持する。
 *
 * - oauth_session: `@atproto/oauth-client-node` のセッション（トークン・DPoP鍵）。
 *   値は `SKYSEAL_ENCRYPTION_KEY` で暗号化してから格納する（暗号化自体はOAuth
 *   セッションストア実装側の責務）。キーはDID（ライブラリのNodeSavedSessionStoreの`sub`）。
 * - oauth_state: OAuth認可フロー中の一時state。キーはライブラリが払い出す不透明な文字列。
 * - app_session: アプリセッション（要件7.3、oauth-session.md 5.）。
 *
 * ネタバレ本文はいずれのテーブルにも保存しない（要件7.1、7.2）。
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS oauth_session (
  did TEXT PRIMARY KEY,
  session_data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_state (
  state_key TEXT PRIMARY KEY,
  state_data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_session (
  session_id TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  csrf_secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_session_expires_at ON app_session (expires_at);
`;

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}
