/**
 * AT Protocolの識別子・データ形式に関する構文検証。
 *
 * content-api.md 1.・5. と lexicon.md 1. の要求を満たす。
 * 依存を増やさないため、AT Protocol仕様（atproto.com/specs）に定められた
 * 正規表現・制約をこのモジュール内で自前に実装する。フォールバック的な緩和はしない
 * （対応外のDIDメソッド・不正な形式は明確に「不正」として扱う）。
 */

/** 解析済みDID。対応するのは did:plc と did:web のみ（content-api.md 1.）。 */
export type ParsedDid =
  | { readonly method: "plc"; readonly did: string }
  | { readonly method: "web"; readonly did: string; readonly host: string };

// did:plc は base32-sortable の24文字（a-z, 2-7）。
const DID_PLC_REGEX = /^did:plc:[a-z2-7]{24}$/;

/**
 * DID文字列を解析する。did:plc / did:web のみを許可し、それ以外・不正な構文は `null` を返す。
 * did:web はホスト名（任意でポート）のみを許可し、path-basedな did:web
 * （コロン区切りのパスを含むもの）は拒否する。
 */
export function parseDid(did: string): ParsedDid | null {
  if (DID_PLC_REGEX.test(did)) {
    return { method: "plc", did };
  }

  const WEB_PREFIX = "did:web:";
  if (!did.startsWith(WEB_PREFIX)) {
    return null;
  }
  const msid = did.slice(WEB_PREFIX.length);
  if (msid.length === 0) {
    return null;
  }
  // path-based did:web（未エンコードのコロンでパスを区切るもの）は非対応。
  // ホスト名のポートは %3A としてエンコードされるため、この時点でのコロンは常にパス区切り。
  if (msid.includes(":")) {
    return null;
  }

  let host: string;
  try {
    host = decodeURIComponent(msid);
  } catch {
    return null;
  }

  let url: URL;
  try {
    url = new URL(`https://${host}`);
  } catch {
    return null;
  }
  // ホスト名以外の要素（パス・クエリ・フラグメント・認証情報）を含む場合は不正。
  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hostname === ""
  ) {
    return null;
  }

  return { method: "web", did, host: url.host };
}

// record-key構文（atproto.com/specs/record-key）。
const RECORD_KEY_REGEX = /^[a-zA-Z0-9_~.:-]{1,512}$/;

/** record-key構文に適合するか（1〜512文字、許可文字のみ、"." と ".." を除く）。 */
export function isValidRecordKey(rkey: string): boolean {
  if (rkey.length < 1 || rkey.length > 512) {
    return false;
  }
  if (rkey === "." || rkey === "..") {
    return false;
  }
  return RECORD_KEY_REGEX.test(rkey);
}

// atproto datetime（RFC 3339 & ISO 8601、タイムゾーン必須）。
// atproto.com/specs/lexicon#datetime に基づく。
const DATETIME_REGEX =
  /^(\d{4})-(0[1-9]|1[012])-([0-2]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d|60)(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

/** atproto仕様の datetime 形式に適合するか。 */
export function isValidDatetime(input: string): boolean {
  if (input.length > 64) {
    return false;
  }
  // "-00:00"（UTCの負ゼロ表記）は禁止。
  if (input.endsWith("-00:00")) {
    return false;
  }
  const match = DATETIME_REGEX.exec(input);
  if (match === null) {
    return false;
  }
  // 正規表現では月ごとの日数（例: 2月31日）を検証できないため、暦日として
  // 実在するかをY-M-Dの各フィールドだけで確認する（タイムゾーンオフセットの
  // 有無に影響されないよう、時刻・オフセットには触れない）。
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  return true;
}

// ハンドル構文（atproto.com/specs/handle）。ドメイン形式。
const HANDLE_REGEX =
  /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

/** ハンドル構文（ドメイン名形式）に適合するか。 */
export function isValidHandle(handle: string): boolean {
  if (handle.length < 1 || handle.length > 253) {
    return false;
  }
  return HANDLE_REGEX.test(handle);
}

/** 文字列のUTF-8バイト長。 */
export function utf8ByteLength(input: string): number {
  return Buffer.byteLength(input, "utf8");
}
