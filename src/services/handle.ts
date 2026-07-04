import { resolveTxt as dnsResolveTxt } from "node:dns/promises";
import { safeFetch } from "../lib/safe-fetch.js";
import type { FetchFn } from "./did.js";

/**
 * ハンドル → DID の解決（content-api.md 2. ステップ6の双方向検証に使う）。
 *
 * AT Protocol標準の2方式で解決する:
 * 1. DNS TXT `_atproto.{handle}` の `did=...` 値（権威）。
 * 2. DNSに `_atproto` レコードが無い場合のみ、`https://{handle}/.well-known/atproto-did`。
 *
 * これは仕様が定める正規の解決手順であり、互換のための劣化経路ではない。
 * HTTP取得は safeFetch 経由（ハンドルは第三者制御値のためSSRF対策必須）。
 */

export type ResolveTxtFn = (hostname: string) => Promise<string[][]>;

export interface HandleResolver {
  /** ハンドルを解決して得られたDIDを返す。解決できなければ null。 */
  resolve(handle: string): Promise<string | null>;
}

export interface CreateHandleResolverOptions {
  /** 外部HTTP取得関数。既定値: safeFetch */
  fetch?: FetchFn;
  /** DNS TXT解決関数。既定値: node:dns/promises の resolveTxt */
  resolveTxt?: ResolveTxtFn;
  /** well-known 取得のレスポンス上限バイト数。既定値: 2KiB */
  maxResponseBytes?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024;
const DID_PREFIX = "did:";

export function createHandleResolver(options: CreateHandleResolverOptions = {}): HandleResolver {
  const fetch = options.fetch ?? safeFetch;
  const resolveTxt = options.resolveTxt ?? dnsResolveTxt;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  async function resolveViaDns(handle: string): Promise<string | null> {
    let records: string[][];
    try {
      records = await resolveTxt(`_atproto.${handle}`);
    } catch {
      // NXDOMAIN 等はDNSに記載なしとみなし、HTTPへ進む。
      return null;
    }
    for (const chunks of records) {
      const value = chunks.join("");
      if (value.startsWith("did=")) {
        const did = value.slice("did=".length);
        if (did.startsWith(DID_PREFIX)) {
          return did;
        }
      }
    }
    return null;
  }

  async function resolveViaHttp(handle: string): Promise<string | null> {
    try {
      const result = await fetch(`https://${handle}/.well-known/atproto-did`, {
        method: "GET",
        maxResponseBytes,
      });
      if (result.status !== 200) {
        return null;
      }
      const did = result.body.toString("utf8").trim();
      if (did.startsWith(DID_PREFIX)) {
        return did;
      }
      return null;
    } catch {
      return null;
    }
  }

  return {
    async resolve(handle: string): Promise<string | null> {
      const viaDns = await resolveViaDns(handle);
      if (viaDns !== null) {
        return viaDns;
      }
      return resolveViaHttp(handle);
    },
  };
}
