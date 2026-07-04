import type { ParsedDid } from "../lib/atproto-syntax.js";
import { isValidHandle } from "../lib/atproto-syntax.js";
import type { SafeFetchOptions, SafeFetchResult } from "../lib/safe-fetch.js";
import { safeFetch } from "../lib/safe-fetch.js";

/**
 * DID解決（content-api.md 2. ステップ3、6.）。
 *
 * did:plc は plc.directory、did:web は https://{host}/.well-known/did.json から
 * DIDドキュメントを取得し、`id` の一致を検証して PDS エンドポイントと
 * ハンドル候補（alsoKnownAs）を得る。すべて safeFetch 経由（SSRF対策）。
 *
 * 解決結果（PDS URL・ハンドル候補）は本文ではないため短TTLのインメモリキャッシュを
 * 許可する（content-api.md 3.）。本文・レスポンスボディはキャッシュしない。
 */

export type FetchFn = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResult>;

export interface ResolvedDid {
  /** PDS（Personal Data Server）のエンドポイントURL（https） */
  readonly pdsUrl: string;
  /** DIDドキュメントの alsoKnownAs 由来のハンドル候補（未検証）。無ければ null */
  readonly handleCandidate: string | null;
}

export interface DidResolver {
  resolve(parsed: ParsedDid): Promise<ResolvedDid | null>;
}

export interface CreateDidResolverOptions {
  /** 外部HTTP取得関数。既定値: safeFetch。テストで差し替える */
  fetch?: FetchFn;
  /** 単調増加でなくてよい現在時刻（ms）。既定値: Date.now */
  now?: () => number;
  /** キャッシュTTL（ms）。既定値: 300000（5分） */
  cacheTtlMs?: number;
  /** DIDドキュメント取得のレスポンス上限バイト数。既定値: 64KiB */
  maxResponseBytes?: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const PLC_DIRECTORY_ORIGIN = "https://plc.directory";
const ATPROTO_PDS_SERVICE_TYPE = "AtprotoPersonalDataServer";

interface CacheEntry {
  value: ResolvedDid;
  expiresAt: number;
}

export function createDidResolver(options: CreateDidResolverOptions = {}): DidResolver {
  const fetch = options.fetch ?? safeFetch;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  const cache = new Map<string, CacheEntry>();

  async function resolve(parsed: ParsedDid): Promise<ResolvedDid | null> {
    const cached = cache.get(parsed.did);
    if (cached && cached.expiresAt > now()) {
      return cached.value;
    }
    if (cached) {
      cache.delete(parsed.did);
    }

    const doc = await fetchDidDocument(parsed);
    if (doc === null) {
      return null;
    }

    // DIDドキュメントの id が要求したDIDと一致することを検証する（content-api.md 2.-3.）。
    if (doc.id !== parsed.did) {
      return null;
    }

    const pdsUrl = extractPdsEndpoint(doc);
    if (pdsUrl === null) {
      return null;
    }

    const resolved: ResolvedDid = {
      pdsUrl,
      handleCandidate: extractHandleCandidate(doc),
    };
    cache.set(parsed.did, { value: resolved, expiresAt: now() + cacheTtlMs });
    return resolved;
  }

  async function fetchDidDocument(parsed: ParsedDid): Promise<DidDocument | null> {
    const url =
      parsed.method === "plc"
        ? `${PLC_DIRECTORY_ORIGIN}/${parsed.did}`
        : `https://${parsed.host}/.well-known/did.json`;

    let result: SafeFetchResult;
    try {
      result = await fetch(url, { method: "GET", maxResponseBytes });
    } catch {
      return null;
    }
    if (result.status !== 200) {
      return null;
    }
    let parsedDoc: unknown;
    try {
      parsedDoc = JSON.parse(result.body.toString("utf8"));
    } catch {
      return null;
    }
    if (!isDidDocument(parsedDoc)) {
      return null;
    }
    return parsedDoc;
  }

  return { resolve };
}

interface DidDocumentService {
  id?: unknown;
  type?: unknown;
  serviceEndpoint?: unknown;
}

interface DidDocument {
  id: string;
  alsoKnownAs?: unknown;
  service?: DidDocumentService[];
}

function isDidDocument(value: unknown): value is DidDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj.id === "string";
}

/** `#atproto_pds` サービスの https エンドポイントを取り出す。無ければ null。 */
function extractPdsEndpoint(doc: DidDocument): string | null {
  if (!Array.isArray(doc.service)) {
    return null;
  }
  for (const service of doc.service) {
    if (typeof service !== "object" || service === null) {
      continue;
    }
    const id = service.id;
    const type = service.type;
    const endpoint = service.serviceEndpoint;
    if (typeof id !== "string" || typeof type !== "string" || typeof endpoint !== "string") {
      continue;
    }
    if (type !== ATPROTO_PDS_SERVICE_TYPE) {
      continue;
    }
    if (id !== "#atproto_pds" && !id.endsWith("#atproto_pds")) {
      continue;
    }
    // https以外のエンドポイントは許可しない（フォールバックなし）。
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return null;
    }
    if (url.protocol !== "https:") {
      return null;
    }
    return endpoint;
  }
  return null;
}

/** alsoKnownAs 先頭の `at://` エントリからハンドル候補を取り出す（未検証）。 */
function extractHandleCandidate(doc: DidDocument): string | null {
  if (!Array.isArray(doc.alsoKnownAs)) {
    return null;
  }
  for (const aka of doc.alsoKnownAs) {
    if (typeof aka !== "string" || !aka.startsWith("at://")) {
      continue;
    }
    const handle = aka.slice("at://".length);
    if (isValidHandle(handle)) {
      return handle;
    }
  }
  return null;
}
