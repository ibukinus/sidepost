import { buildAnnouncementUrl } from "../lib/at-uri.js";
import type { ParsedDid } from "../lib/atproto-syntax.js";
import { isValidDatetime, isValidRecordKey, utf8ByteLength } from "../lib/atproto-syntax.js";
import type { SafeFetchResult } from "../lib/safe-fetch.js";
import { safeFetch } from "../lib/safe-fetch.js";
import type { DidResolver, FetchFn } from "./did.js";
import { createDidResolver } from "./did.js";
import type { HandleResolver } from "./handle.js";
import { createHandleResolver } from "./handle.js";
import { buildGetRecordUrl } from "./pds-read.js";

export type { FetchFn } from "./did.js";

/**
 * 本文取得の中核処理（content-api.md 2.）。
 *
 * DID解決 → レコード取得 → 形式検証 → 投稿者情報取得（ベストエフォート）を行う。
 * 表示できない場合は理由を区別せず `null` を返す（呼び出し側で一律404に写像する）。
 *
 * 本文はこの処理中のメモリ上にのみ存在させ、永続化・キャッシュ・ログ出力をしない
 * （content-api.md 3.、要件7.1/7.2）。
 */

const SPOILER_COLLECTION = "jp.mp0.skyseal.post";
const PROFILE_COLLECTION = "app.bsky.actor.profile";
const PROFILE_RKEY = "self";
const SPOILER_TEXT_MAX_BYTES = 7500;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

export interface SpoilerAuthor {
  did: string;
  handle?: string;
  displayName?: string;
}

export interface SpoilerResult {
  text: string;
  createdAt: string;
  author: SpoilerAuthor;
  announcementUrl: string;
}

export interface ContentService {
  /** 表示可能なら本文レスポンスを、表示できなければ null を返す。 */
  getSpoiler(parsed: ParsedDid, rkey: string): Promise<SpoilerResult | null>;
}

export interface CreateContentServiceOptions {
  fetch?: FetchFn;
  didResolver?: DidResolver;
  handleResolver?: HandleResolver;
  /** レコード取得のレスポンス上限バイト数。既定値: 64KiB */
  maxResponseBytes?: number;
}

interface ValidatedSpoiler {
  text: string;
  createdAt: string;
  announcementRkey: string;
}

export function createContentService(options: CreateContentServiceOptions = {}): ContentService {
  const fetch = options.fetch ?? safeFetch;
  const didResolver = options.didResolver ?? createDidResolver({ fetch });
  const handleResolver = options.handleResolver ?? createHandleResolver({ fetch });
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  async function getRecordValue(
    pdsUrl: string,
    did: string,
    collection: string,
    rkey: string,
  ): Promise<unknown | null> {
    const url = buildGetRecordUrl(pdsUrl, did, collection, rkey);

    let result: SafeFetchResult;
    try {
      result = await fetch(url, { method: "GET", maxResponseBytes });
    } catch {
      return null;
    }
    if (result.status !== 200) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body.toString("utf8"));
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return (parsed as Record<string, unknown>).value ?? null;
  }

  async function resolveDisplayName(pdsUrl: string, did: string): Promise<string | undefined> {
    const value = await getRecordValue(pdsUrl, did, PROFILE_COLLECTION, PROFILE_RKEY);
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const displayName = (value as Record<string, unknown>).displayName;
    if (typeof displayName === "string" && displayName.length > 0) {
      return displayName;
    }
    return undefined;
  }

  async function verifyHandle(candidate: string | null, did: string): Promise<string | undefined> {
    if (candidate === null) {
      return undefined;
    }
    let resolvedDid: string | null;
    try {
      resolvedDid = await handleResolver.resolve(candidate);
    } catch {
      return undefined;
    }
    return resolvedDid === did ? candidate : undefined;
  }

  async function getSpoiler(parsed: ParsedDid, rkey: string): Promise<SpoilerResult | null> {
    const resolved = await didResolver.resolve(parsed);
    if (resolved === null) {
      return null;
    }

    const recordValue = await getRecordValue(resolved.pdsUrl, parsed.did, SPOILER_COLLECTION, rkey);
    const validated = validateSpoilerRecord(recordValue);
    if (validated === null) {
      return null;
    }

    // 投稿者情報はベストエフォート。失敗しても本文の返却を妨げない。
    const displayName = await resolveDisplayName(resolved.pdsUrl, parsed.did).catch(
      () => undefined,
    );
    const handle = await verifyHandle(resolved.handleCandidate, parsed.did);

    const author: SpoilerAuthor = { did: parsed.did };
    if (handle !== undefined) {
      author.handle = handle;
    }
    if (displayName !== undefined) {
      author.displayName = displayName;
    }

    return {
      text: validated.text,
      createdAt: validated.createdAt,
      author,
      announcementUrl: buildAnnouncementUrl(parsed.did, validated.announcementRkey),
    };
  }

  return { getSpoiler };
}

/**
 * `jp.mp0.skyseal.post` レコードのアプリレベル形式検証（content-api.md 2. ステップ5、lexicon.md）。
 * 不正なら null。
 */
export function validateSpoilerRecord(value: unknown): ValidatedSpoiler | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;

  if (record.$type !== SPOILER_COLLECTION) {
    return null;
  }

  const text = record.text;
  if (typeof text !== "string") {
    return null;
  }
  const textBytes = utf8ByteLength(text);
  if (textBytes < 1 || textBytes > SPOILER_TEXT_MAX_BYTES) {
    return null;
  }

  const createdAt = record.createdAt;
  if (typeof createdAt !== "string" || !isValidDatetime(createdAt)) {
    return null;
  }

  const announcementRkey = record.announcementRkey;
  if (typeof announcementRkey !== "string" || !isValidRecordKey(announcementRkey)) {
    return null;
  }

  return { text, createdAt, announcementRkey };
}
