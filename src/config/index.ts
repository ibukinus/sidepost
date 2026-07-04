import * as fs from "node:fs";
import * as path from "node:path";
import { isValidCidr } from "../lib/ip.js";

/**
 * 起動時設定の読み込みと検証。
 *
 * architecture.md 7. に列挙された環境変数を検証し、不足・不正があれば
 * `ConfigError` を投げて起動を失敗させる。フォールバック値は設けない
 * （SKYSEAL_TRUSTED_PROXIES のみ、未設定＝信頼するプロキシなしという
 * 仕様上有効な状態であり、content-api.md 5. の定めどおり空配列を返す）。
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface OAuthPrivateJwk {
  kty: "EC";
  crv: "P-256";
  kid: string;
  d: string;
  x: string;
  y: string;
  alg?: string;
}

export interface Config {
  /** サービスオリジン（例: https://skyseal.mp0.jp）。パス・クエリ・フラグメントは含まない */
  origin: string;
  /** SQLiteファイルのパス */
  dbPath: string;
  /** OAuthセッション暗号化鍵（AES-256-GCM用、32バイト） */
  encryptionKey: Buffer;
  /** OAuthクライアント認証用の秘密鍵集合（ES256 JWK、oauth-session.md 1.） */
  oauthPrivateKeys: OAuthPrivateJwk[];
  /** 信頼するリバースプロキシのCIDR一覧。未設定時は空配列 */
  trustedProxies: string[];
  /** 表示停止リストファイルのパス */
  denylistPath: string;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: EnvSource = process.env): Config {
  return {
    origin: readOrigin(env),
    dbPath: readDbPath(env),
    encryptionKey: readEncryptionKey(env),
    oauthPrivateKeys: readOauthPrivateKeys(env),
    trustedProxies: readTrustedProxies(env),
    denylistPath: readDenylistPath(env),
  };
}

function requireEnv(env: EnvSource, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(`環境変数 ${key} が設定されていません`);
  }
  return value;
}

function readOrigin(env: EnvSource): string {
  const raw = requireEnv(env, "SKYSEAL_ORIGIN");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`SKYSEAL_ORIGIN が不正なURLです: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError(`SKYSEAL_ORIGIN はhttpまたはhttpsのURLである必要があります: ${raw}`);
  }
  if ((url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "") {
    throw new ConfigError(
      `SKYSEAL_ORIGIN はオリジンのみを指定してください（パス・クエリ・フラグメント不可）: ${raw}`,
    );
  }
  return url.origin;
}

function readDbPath(env: EnvSource): string {
  const raw = requireEnv(env, "SKYSEAL_DB_PATH");
  const dir = path.dirname(path.resolve(raw));
  if (!fs.existsSync(dir)) {
    throw new ConfigError(`SKYSEAL_DB_PATH の親ディレクトリが存在しません: ${dir}`);
  }
  return raw;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function readEncryptionKey(env: EnvSource): Buffer {
  const raw = requireEnv(env, "SKYSEAL_ENCRYPTION_KEY");
  if (raw.length % 4 !== 0 || !BASE64_PATTERN.test(raw)) {
    throw new ConfigError("SKYSEAL_ENCRYPTION_KEY はbase64形式で指定してください");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new ConfigError(
      `SKYSEAL_ENCRYPTION_KEY はデコード後32バイト（AES-256-GCM用）である必要があります（実際: ${key.length}バイト）`,
    );
  }
  return key;
}

function readOauthPrivateKeys(env: EnvSource): OAuthPrivateJwk[] {
  const raw = requireEnv(env, "SKYSEAL_OAUTH_PRIVATE_KEYS");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(
      "SKYSEAL_OAUTH_PRIVATE_KEYS はJWKのJSON配列である必要があります（JSONとして解析できません）",
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ConfigError("SKYSEAL_OAUTH_PRIVATE_KEYS は要素数1以上のJSON配列である必要があります");
  }

  const keys = parsed.map((entry, index) => validateOAuthPrivateJwk(entry, index));

  const seenKids = new Set<string>();
  for (const jwk of keys) {
    if (seenKids.has(jwk.kid)) {
      throw new ConfigError(`SKYSEAL_OAUTH_PRIVATE_KEYS に重複したkidがあります: ${jwk.kid}`);
    }
    seenKids.add(jwk.kid);
  }

  return keys;
}

function validateOAuthPrivateJwk(entry: unknown, index: number): OAuthPrivateJwk {
  if (typeof entry !== "object" || entry === null) {
    throw new ConfigError(
      `SKYSEAL_OAUTH_PRIVATE_KEYS[${index}] はオブジェクトである必要があります`,
    );
  }
  const jwk = entry as Record<string, unknown>;

  // oauth-session.md 1.: token_endpoint_auth_method=private_key_jwt, alg=ES256 (EC P-256)
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new ConfigError(
      `SKYSEAL_OAUTH_PRIVATE_KEYS[${index}] はES256用のEC P-256 JWKである必要があります`,
    );
  }
  for (const field of ["kid", "d", "x", "y"] as const) {
    const value = jwk[field];
    if (typeof value !== "string" || value === "") {
      throw new ConfigError(
        `SKYSEAL_OAUTH_PRIVATE_KEYS[${index}].${field} は非空の文字列である必要があります`,
      );
    }
  }

  return jwk as unknown as OAuthPrivateJwk;
}

function readTrustedProxies(env: EnvSource): string[] {
  const raw = env.SKYSEAL_TRUSTED_PROXIES;
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    if (!isValidCidr(entry)) {
      throw new ConfigError(`SKYSEAL_TRUSTED_PROXIES に不正なCIDRがあります: ${entry}`);
    }
  }
  return entries;
}

function readDenylistPath(env: EnvSource): string {
  const raw = requireEnv(env, "SKYSEAL_DENYLIST_PATH");
  if (!fs.existsSync(raw) || !fs.statSync(raw).isFile()) {
    throw new ConfigError(`SKYSEAL_DENYLIST_PATH が指すファイルが存在しません: ${raw}`);
  }
  return raw;
}
