import { parseDid } from "../lib/atproto-syntax.js";
import type { SafeFetchResult } from "../lib/safe-fetch.js";
import { safeFetch } from "../lib/safe-fetch.js";
import type { DidResolver, FetchFn } from "./did.js";
import { createDidResolver } from "./did.js";

/**
 * PDSからの認証なし読み取り（oauth-session.md 2.、content-api.md 6.）。
 *
 * `com.atproto.repo.getRecord` / `com.atproto.repo.listRecords` /
 * `com.atproto.sync.getLatestCommit` はいずれも公開エンドポイントとして
 * 認証なしで呼べる。OAuth Agent（`repo:` create/delete のみのgranular scope）で
 * 読み取りを行うと、スコープを厳密に強制するPDSで拒否され得るため、読み取りは
 * すべてこのサービス経由（DID→PDS解決 → 公開XRPCをsafeFetchで呼ぶ）で行う。
 *
 * AGENTS.md/CLAUDE.mdの方針に従い、認証付き読み取りへのフォールバックは設けない。
 *
 * すべての外部HTTPは safeFetch 経由（SSRF対策）。自分のDID（セッションDID）の
 * PDS解決も第三者制御値と同様に safeFetch を通す。レスポンスの生値・本文は
 * ログに出さず、エラーは種別（HTTPステータス・種別名）のみを保持する。
 */

export type { FetchFn } from "./did.js";

const DEFAULT_MAX_RECORD_BYTES = 64 * 1024;
// 一覧は最大50件×本文最大7,500バイトを含み得るため、レコード取得より大きめの上限を置く。
const DEFAULT_MAX_LIST_BYTES = 1024 * 1024;
const DEFAULT_MAX_COMMIT_BYTES = 64 * 1024;

export type PdsReadErrorReason =
  | "invalid-did"
  | "did-unresolved"
  | "http-error"
  | "network-error"
  | "invalid-response";

/** RecordNotFound以外のPDS読み取り失敗（削除フローでは一律 pds-error に写像する）。 */
export class PdsReadError extends Error {
  readonly reason: PdsReadErrorReason;

  constructor(reason: PdsReadErrorReason, message: string) {
    super(message);
    this.name = "PdsReadError";
    this.reason = reason;
  }
}

/**
 * 公開XRPC `getRecord` が返す「レコード不在」（HTTP 400 + `error: "RecordNotFound"`）。
 * 削除フローで「すでに削除済み」を判別するために他のエラーと区別する。
 */
export class PdsRecordNotFoundError extends Error {
  constructor() {
    super("レコードが見つかりません");
    this.name = "PdsRecordNotFoundError";
  }
}

export interface RepoRecord {
  uri: string;
  cid?: string;
  value: unknown;
}

export interface ListRecordsResult {
  cursor?: string;
  records: RepoRecord[];
}

export interface ListRecordsOptions {
  limit?: number;
  cursor?: string;
  reverse?: boolean;
}

export interface LatestCommit {
  cid: string;
  rev: string;
}

export interface PdsReader {
  /** レコードの `value` を返す。不在は {@link PdsRecordNotFoundError}、その他失敗は {@link PdsReadError}。 */
  getRecord(did: string, collection: string, rkey: string): Promise<unknown>;
  /** リポジトリのレコード一覧を返す。失敗は {@link PdsReadError}。 */
  listRecords(
    did: string,
    collection: string,
    options?: ListRecordsOptions,
  ): Promise<ListRecordsResult>;
  /** リポジトリの最新コミット（swapCommitの基準）。失敗は {@link PdsReadError}。 */
  getLatestCommit(did: string): Promise<LatestCommit>;
}

export interface CreatePdsReaderOptions {
  fetch?: FetchFn;
  didResolver?: DidResolver;
  /** getRecord のレスポンス上限バイト数。既定値: 64KiB */
  maxRecordBytes?: number;
  /** listRecords のレスポンス上限バイト数。既定値: 1MiB */
  maxListBytes?: number;
  /** getLatestCommit のレスポンス上限バイト数。既定値: 64KiB */
  maxCommitBytes?: number;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** `com.atproto.repo.getRecord`（認証なし）のURLを組み立てる。content.ts と共有する。 */
export function buildGetRecordUrl(
  pdsUrl: string,
  did: string,
  collection: string,
  rkey: string,
): string {
  return `${trimTrailingSlash(pdsUrl)}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(
    did,
  )}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
}

function buildListRecordsUrl(
  pdsUrl: string,
  did: string,
  collection: string,
  options: ListRecordsOptions,
): string {
  const params = new URLSearchParams({ repo: did, collection });
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.cursor !== undefined) {
    params.set("cursor", options.cursor);
  }
  if (options.reverse !== undefined) {
    params.set("reverse", String(options.reverse));
  }
  return `${trimTrailingSlash(pdsUrl)}/xrpc/com.atproto.repo.listRecords?${params.toString()}`;
}

function buildGetLatestCommitUrl(pdsUrl: string, did: string): string {
  return `${trimTrailingSlash(pdsUrl)}/xrpc/com.atproto.sync.getLatestCommit?did=${encodeURIComponent(
    did,
  )}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createPdsReader(options: CreatePdsReaderOptions = {}): PdsReader {
  const fetch = options.fetch ?? safeFetch;
  const didResolver = options.didResolver ?? createDidResolver({ fetch });
  const maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
  const maxListBytes = options.maxListBytes ?? DEFAULT_MAX_LIST_BYTES;
  const maxCommitBytes = options.maxCommitBytes ?? DEFAULT_MAX_COMMIT_BYTES;

  async function resolvePdsUrl(did: string): Promise<string> {
    const parsed = parseDid(did);
    if (parsed === null) {
      throw new PdsReadError("invalid-did", "DIDの解析に失敗しました");
    }
    const resolved = await didResolver.resolve(parsed);
    if (resolved === null) {
      throw new PdsReadError("did-unresolved", "DIDの解決に失敗しました");
    }
    return resolved.pdsUrl;
  }

  /** 認証なしのGET。Authorizationヘッダは付けない。JSONを解析して {status, json} を返す。 */
  async function xrpcGet(
    url: string,
    maxResponseBytes: number,
  ): Promise<{ status: number; json: unknown }> {
    let result: SafeFetchResult;
    try {
      result = await fetch(url, { method: "GET", maxResponseBytes });
    } catch {
      throw new PdsReadError("network-error", "PDSへの接続に失敗しました");
    }
    let json: unknown;
    try {
      json = JSON.parse(result.body.toString("utf8"));
    } catch {
      throw new PdsReadError("invalid-response", "PDS応答の解析に失敗しました");
    }
    return { status: result.status, json };
  }

  async function getRecord(did: string, collection: string, rkey: string): Promise<unknown> {
    const pdsUrl = await resolvePdsUrl(did);
    const { status, json } = await xrpcGet(
      buildGetRecordUrl(pdsUrl, did, collection, rkey),
      maxRecordBytes,
    );
    if (status === 200) {
      if (!isObject(json)) {
        throw new PdsReadError("invalid-response", "PDS応答が不正です");
      }
      return json.value ?? null;
    }
    // 公開getRecordのレコード不在は 400 + error:"RecordNotFound"。
    if (status === 400 && isObject(json) && json.error === "RecordNotFound") {
      throw new PdsRecordNotFoundError();
    }
    throw new PdsReadError("http-error", `PDSがエラーを返しました（status=${status}）`);
  }

  async function listRecords(
    did: string,
    collection: string,
    listOptions: ListRecordsOptions = {},
  ): Promise<ListRecordsResult> {
    const pdsUrl = await resolvePdsUrl(did);
    const { status, json } = await xrpcGet(
      buildListRecordsUrl(pdsUrl, did, collection, listOptions),
      maxListBytes,
    );
    if (status !== 200) {
      throw new PdsReadError("http-error", `PDSがエラーを返しました（status=${status}）`);
    }
    if (!isObject(json) || !Array.isArray(json.records)) {
      throw new PdsReadError("invalid-response", "PDS応答が不正です");
    }
    const records: RepoRecord[] = [];
    for (const entry of json.records) {
      if (!isObject(entry) || typeof entry.uri !== "string") {
        // レコード配列内の不正なエントリは無視する（一覧側でさらに検証する）。
        continue;
      }
      const record: RepoRecord = { uri: entry.uri, value: entry.value ?? null };
      if (typeof entry.cid === "string") {
        record.cid = entry.cid;
      }
      records.push(record);
    }
    const result: ListRecordsResult = { records };
    if (typeof json.cursor === "string") {
      result.cursor = json.cursor;
    }
    return result;
  }

  async function getLatestCommit(did: string): Promise<LatestCommit> {
    const pdsUrl = await resolvePdsUrl(did);
    const { status, json } = await xrpcGet(buildGetLatestCommitUrl(pdsUrl, did), maxCommitBytes);
    if (status !== 200 || !isObject(json) || typeof json.cid !== "string") {
      throw new PdsReadError("http-error", `PDSがエラーを返しました（status=${status}）`);
    }
    return { cid: json.cid, rev: typeof json.rev === "string" ? json.rev : "" };
  }

  return { getRecord, listRecords, getLatestCommit };
}
