import { BlockList, isIP } from "node:net";

/**
 * クライアントIPの決定（content-api.md 5.）。
 *
 * 信頼するリバースプロキシのCIDR（`SKYSEAL_TRUSTED_PROXIES`）を前提に、
 * 接続元がその範囲内の場合のみ `X-Forwarded-For` を採用する。範囲外からの
 * `X-Forwarded-For` は無視し、未設定時は一切信用しない（フォールバックなし）。
 */

export type TrustedProxyChecker = (address: string) => boolean;

/**
 * 信頼するプロキシCIDR一覧から、あるIPがその範囲に含まれるかを判定する関数を作る。
 * CIDRは事前に `isValidCidr` で検証済みである前提（不正な要素は無視する）。
 */
export function createTrustedProxyChecker(cidrs: readonly string[]): TrustedProxyChecker {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const separatorIndex = cidr.lastIndexOf("/");
    if (separatorIndex <= 0) {
      continue;
    }
    const address = cidr.slice(0, separatorIndex);
    const prefix = Number(cidr.slice(separatorIndex + 1));
    const family = isIP(address);
    if (family !== 4 && family !== 6) {
      continue;
    }
    try {
      list.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
    } catch {
      // 事前検証済みのため通常は到達しない。安全側に倒して無視する。
    }
  }
  return (address: string): boolean => {
    const family = isIP(address);
    if (family !== 4 && family !== 6) {
      return false;
    }
    return list.check(address, family === 4 ? "ipv4" : "ipv6");
  };
}

export interface ResolveClientIpInput {
  /** TCP接続元のIP（リバースプロキシ配下ではプロキシのIP）。不明なら undefined */
  readonly remoteAddress: string | undefined;
  /** `X-Forwarded-For` ヘッダの生値 */
  readonly forwardedFor: string | undefined;
  /** 信頼するプロキシ範囲の判定関数 */
  readonly isTrustedProxy: TrustedProxyChecker;
  /** 信頼するプロキシが1つ以上設定されているか */
  readonly hasTrustedProxies: boolean;
}

/** クライアントIPを特定できない場合に使うレート制限用の代替キー。 */
export const UNKNOWN_CLIENT_IP = "unknown";

/**
 * クライアントIPを決定する（content-api.md 5.）。
 *
 * - 信頼するプロキシ未設定時は `X-Forwarded-For` を信用せず接続元IPを使う。
 * - 接続元が信頼するプロキシ範囲外なら `X-Forwarded-For` を無視し接続元IPを使う。
 * - 接続元が信頼するプロキシ範囲内の場合のみ、`X-Forwarded-For` の右端から
 *   信頼プロキシを除いた最初の値をクライアントIPとして採用する。
 */
export function resolveClientIp(input: ResolveClientIpInput): string {
  const { remoteAddress, forwardedFor, isTrustedProxy, hasTrustedProxies } = input;

  if (!hasTrustedProxies) {
    return remoteAddress ?? UNKNOWN_CLIENT_IP;
  }
  if (remoteAddress === undefined || !isTrustedProxy(remoteAddress)) {
    return remoteAddress ?? UNKNOWN_CLIENT_IP;
  }
  if (forwardedFor === undefined) {
    return remoteAddress;
  }

  const entries = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (let i = entries.length - 1; i >= 0; i--) {
    const candidate = normalizeForwardedEntry(entries[i] as string);
    if (candidate === null) {
      continue;
    }
    if (isTrustedProxy(candidate)) {
      continue;
    }
    return candidate;
  }
  return remoteAddress;
}

/** `X-Forwarded-For` の1エントリを正規化してIPリテラルを取り出す（ポート等を除去）。 */
function normalizeForwardedEntry(raw: string): string | null {
  if (isIP(raw)) {
    return raw;
  }
  // [IPv6]:port 形式
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end > 1) {
      const inner = raw.slice(1, end);
      if (isIP(inner)) {
        return inner;
      }
    }
    return null;
  }
  // IPv4:port 形式
  const colon = raw.lastIndexOf(":");
  if (colon > 0) {
    const host = raw.slice(0, colon);
    if (isIP(host)) {
      return host;
    }
  }
  return null;
}
