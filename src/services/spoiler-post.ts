import type { Agent, ComAtprotoRepoApplyWrites } from "@atproto/api";
import { buildDedicatedUrl } from "../lib/at-uri.js";
import { isValidRecordKey, utf8ByteLength } from "../lib/atproto-syntax.js";
import { nextTid } from "../lib/tid.js";

export { buildDedicatedUrl };

/**
 * 投稿作成処理（screens.md 4.1、lexicon.md、要件6.2・6.4・6.5）。
 *
 * `jp.mp0.skyseal.post`（本文レコード）と `app.bsky.feed.post`（案内投稿）を
 * `com.atproto.repo.applyWrites` で1回のリクエストとして作成する。
 * どちらか一方だけが作成される状態は、applyWritesの原子性により生じない。
 *
 * 本モジュールはPDSレスポンスの生値・本文をログに出力しない（要件7.1）。
 */

/** ネタバレ本文レコードのコレクションNSID（lexicon.md 1.）。 */
export const SPOILER_COLLECTION = "jp.mp0.skyseal.post";
const ANNOUNCEMENT_COLLECTION = "app.bsky.feed.post";
/** 本文の最大バイト数（UTF-8）。要件6.2。 */
export const SPOILER_TEXT_MAX_BYTES = 7500;

/** 案内投稿の固定テンプレート（lexicon.md 2.）。URL部分はこの直後に続く。 */
const ANNOUNCEMENT_PREFIX = "ネタバレを含む投稿です。\n\n";
const ANNOUNCEMENT_TITLE = "ネタバレ投稿";
const ANNOUNCEMENT_DESCRIPTION = "ネタバレを含む投稿です。";

export type ComposeValidationError = "empty" | "too-long";

/**
 * 本文のサーバー側検証（要件6.2）。空・空白のみ・7,500バイト超過を拒否する。
 * バイト数はトリム前の入力全体で判定する（本文はそのまま保存するため）。
 */
export function validateComposeText(text: string): ComposeValidationError | null {
  if (text.trim().length === 0) {
    return "empty";
  }
  if (utf8ByteLength(text) > SPOILER_TEXT_MAX_BYTES) {
    return "too-long";
  }
  return null;
}

/** 案内投稿の本文テキスト（lexicon.md 2.）。 */
export function buildAnnouncementText(dedicatedUrl: string): string {
  return `${ANNOUNCEMENT_PREFIX}${dedicatedUrl}`;
}

/** 案内投稿本文中のURLを指すlink facet（lexicon.md 2.）。 */
export interface LinkFacet {
  index: { byteStart: number; byteEnd: number };
  features: { $type: "app.bsky.richtext.facet#link"; uri: string }[];
}

/**
 * 案内投稿のURL部分に付与するlink facet（lexicon.md 2.）。
 * `index` はUTF-8バイト位置で指定する必要があるため、固定プレフィックスの
 * バイト長を起点にURL部分のバイト範囲を算出する。
 */
export function buildAnnouncementFacets(dedicatedUrl: string): LinkFacet[] {
  const byteStart = utf8ByteLength(ANNOUNCEMENT_PREFIX);
  const byteEnd = byteStart + utf8ByteLength(dedicatedUrl);
  return [
    {
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: dedicatedUrl }],
    },
  ];
}

export interface ComposeWritesInput {
  did: string;
  /** 投稿者が入力したネタバレ本文（検証済みであること） */
  text: string;
  /** 本文レコード・案内投稿で共有するISO8601日時 */
  createdAt: string;
  rkeyPost: string;
  rkeyAnnounce: string;
  dedicatedUrl: string;
}

/**
 * `com.atproto.repo.applyWrites` の入力ペイロードを組み立てる（要件6.5、lexicon.md）。
 * 本文レコードと案内投稿の2件を同一配列に含め、1回の呼び出しで原子的に作成する。
 */
export function buildApplyWritesInput(
  input: ComposeWritesInput,
): ComAtprotoRepoApplyWrites.InputSchema {
  const announcementText = buildAnnouncementText(input.dedicatedUrl);

  // lexicon.md 1. のレコード定義（text/createdAt/announcementRkey）。
  const spoilerRecord = {
    $type: SPOILER_COLLECTION,
    text: input.text,
    createdAt: input.createdAt,
    announcementRkey: input.rkeyAnnounce,
  };

  // lexicon.md 2. の固定テンプレート。投稿者による文言追加の余地はない。
  const announcementRecord = {
    $type: ANNOUNCEMENT_COLLECTION,
    text: announcementText,
    langs: ["ja"],
    createdAt: input.createdAt,
    facets: buildAnnouncementFacets(input.dedicatedUrl),
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: input.dedicatedUrl,
        title: ANNOUNCEMENT_TITLE,
        description: ANNOUNCEMENT_DESCRIPTION,
      },
    },
  };

  return {
    repo: input.did,
    writes: [
      {
        $type: "com.atproto.repo.applyWrites#create",
        collection: SPOILER_COLLECTION,
        rkey: input.rkeyPost,
        value: spoilerRecord,
      },
      {
        $type: "com.atproto.repo.applyWrites#create",
        collection: ANNOUNCEMENT_COLLECTION,
        rkey: input.rkeyAnnounce,
        value: announcementRecord,
      },
    ],
  };
}

/** PDSへの書き込みに失敗したことを表す（要件6.5「一括作成に失敗した場合、どちらも投稿完了として扱わない」）。 */
export class SpoilerPostWriteError extends Error {
  constructor(cause: unknown) {
    // PDSレスポンスの生値・例外の詳細はログに出さないため、固定メッセージのみ保持する（要件7.1）。
    super("投稿の作成に失敗しました");
    this.name = "SpoilerPostWriteError";
    this.cause = cause;
  }
}

export interface CreateSpoilerPostResult {
  rkeyPost: string;
  rkeyAnnounce: string;
  dedicatedUrl: string;
}

/**
 * 検証済み本文からTIDを2つ生成し、applyWritesで本文レコード＋案内投稿を作成する
 * （screens.md 4.1、要件6.5）。
 *
 * 呼び出し前提: `text` は `validateComposeText` を通過済みであること。
 * TIDは同期的に連続生成する（tid.tsの単調増加保証はawaitを挟まないことが前提）。
 */
export async function createSpoilerPost(
  agent: Agent,
  origin: string,
  did: string,
  text: string,
): Promise<CreateSpoilerPostResult> {
  const rkeyPost = nextTid();
  const rkeyAnnounce = nextTid();
  // 生成直後に構文を確認する（record-key要件を満たさない値がURLやレコードキーに
  // 使われることを防ぐ防御的チェック。tid.tsの実装が仕様通りなら常に通る）。
  assertValidGeneratedRkey(rkeyPost);
  assertValidGeneratedRkey(rkeyAnnounce);
  const dedicatedUrl = buildDedicatedUrl(origin, did, rkeyPost);
  const createdAt = new Date().toISOString();

  const input = buildApplyWritesInput({
    did,
    text,
    createdAt,
    rkeyPost,
    rkeyAnnounce,
    dedicatedUrl,
  });

  try {
    await agent.com.atproto.repo.applyWrites(input);
  } catch (err) {
    throw new SpoilerPostWriteError(err);
  }

  return { rkeyPost, rkeyAnnounce, dedicatedUrl };
}

/** record-keyとして不正なTIDが渡された場合の防御（ありえないが念のための検証）。 */
export function assertValidGeneratedRkey(rkey: string): void {
  if (!isValidRecordKey(rkey)) {
    throw new Error("生成されたrkeyがrecord-key構文に適合しません");
  }
}
