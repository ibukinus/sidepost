import type { Agent } from "@atproto/api";
import { ComAtprotoRepoApplyWrites, ComAtprotoRepoGetRecord } from "@atproto/api";
import { buildDedicatedUrl } from "../lib/at-uri.js";
import { isValidRecordKey } from "../lib/atproto-syntax.js";
import { validateSpoilerRecord } from "./content.js";
import { buildAnnouncementText } from "./spoiler-post.js";

/**
 * 投稿管理・削除の中核処理（screens.md 3.5・3.6・4.2、lexicon.md 2.）。
 *
 * PDSアクセスは `RepoAgent`（`@atproto/api` の `Agent` の必要最小限の部分集合）経由で行う。
 * 本文はレスポンスの一覧表示用抜粋以外は保持・ログ出力しない（要件7.1・7.2）。
 */

export const SPOILER_COLLECTION = "jp.mp0.skyseal.post";
export const ANNOUNCEMENT_COLLECTION = "app.bsky.feed.post";
export const LIST_PAGE_SIZE = 50;
export const EXCERPT_MAX_CHARS = 50;

/**
 * `Agent`（`@atproto/api`）の必要最小限の部分集合。テストではこの形に沿った
 * フェイクを渡せる。本番では {@link toRepoAgent} で実際の `Agent` を適合させる。
 */
export interface RepoAgent {
  com: {
    atproto: {
      repo: {
        listRecords(params: {
          repo: string;
          collection: string;
          limit?: number;
          cursor?: string;
          reverse?: boolean;
        }): Promise<{
          data: { cursor?: string; records: { uri: string; cid: string; value: unknown }[] };
        }>;
        getRecord(params: {
          repo: string;
          collection: string;
          rkey: string;
        }): Promise<{ data: { uri: string; cid?: string; value: unknown } }>;
        applyWrites(input: {
          repo: string;
          writes: RepoDeleteWrite[];
          swapCommit?: string;
        }): Promise<{ data: unknown }>;
      };
      sync: {
        getLatestCommit(params: { did: string }): Promise<{ data: { cid: string; rev: string } }>;
      };
    };
  };
}

export interface RepoDeleteWrite {
  $type: "com.atproto.repo.applyWrites#delete";
  collection: string;
  rkey: string;
}

/** 実際の `Agent`（`getAgentForDid` の戻り値）を {@link RepoAgent} に適合させる。 */
export function toRepoAgent(agent: Agent): RepoAgent {
  return {
    com: {
      atproto: {
        repo: {
          listRecords: (params) => agent.com.atproto.repo.listRecords(params),
          getRecord: (params) => agent.com.atproto.repo.getRecord(params),
          applyWrites: (input) => agent.com.atproto.repo.applyWrites(input),
        },
        sync: {
          getLatestCommit: (params) => agent.com.atproto.sync.getLatestCommit(params),
        },
      },
    },
  };
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof ComAtprotoRepoGetRecord.RecordNotFoundError;
}

function isInvalidSwap(err: unknown): boolean {
  return err instanceof ComAtprotoRepoApplyWrites.InvalidSwapError;
}

function extractRkeyFromUri(uri: string): string | null {
  const idx = uri.lastIndexOf("/");
  if (idx === -1 || idx === uri.length - 1) {
    return null;
  }
  return uri.slice(idx + 1);
}

/**
 * 本文冒頭の抜粋を作る（screens.md 3.5: 50字程度で切り詰め）。
 * 改行・連続空白は1個のスペースに畳み、UTF-16コードポイント単位ではなくUnicodeコードポイント
 * 単位（サロゲートペア考慮）で数える。
 */
export function truncateExcerpt(text: string, maxChars: number = EXCERPT_MAX_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  if (chars.length <= maxChars) {
    return chars.join("");
  }
  return `${chars.slice(0, maxChars).join("")}…`;
}

export interface SpoilerListItem {
  rkey: string;
  createdAt: string;
  excerpt: string;
}

export interface SpoilerListPage {
  items: SpoilerListItem[];
  nextCursor?: string;
}

/**
 * 自分の `jp.mp0.skyseal.post` レコード一覧（screens.md 3.5）。新しい順、50件ページング。
 * 形式が不正なレコード（他アプリ等が同一コレクションに書き込んだ不正な値）は一覧から除外する。
 */
export async function listSpoilerPosts(
  agent: RepoAgent,
  did: string,
  cursor?: string,
): Promise<SpoilerListPage> {
  const listParams: {
    repo: string;
    collection: string;
    limit: number;
    reverse: boolean;
    cursor?: string;
  } = {
    repo: did,
    collection: SPOILER_COLLECTION,
    limit: LIST_PAGE_SIZE,
    reverse: true,
  };
  if (cursor !== undefined) {
    listParams.cursor = cursor;
  }
  const res = await agent.com.atproto.repo.listRecords(listParams);

  const items: SpoilerListItem[] = [];
  for (const record of res.data.records) {
    const rkey = extractRkeyFromUri(record.uri);
    const validated = validateSpoilerRecord(record.value);
    if (rkey !== null && isValidRecordKey(rkey) && validated !== null) {
      items.push({
        rkey,
        createdAt: validated.createdAt,
        excerpt: truncateExcerpt(validated.text),
      });
    }
  }

  const page: SpoilerListPage = { items };
  if (res.data.cursor !== undefined) {
    page.nextCursor = res.data.cursor;
  }
  return page;
}

export { buildDedicatedUrl };

/**
 * 案内投稿レコードが、skysealが生成した固定テンプレート（lexicon.md 2.）に一致するかを検証する。
 * `$type` と本文全体（固定文言＋対象本文レコードの専用URL）の完全一致のみを条件とする。
 * 一致しないものは、投稿者本人や他アプリが作成した無関係な投稿である可能性があるため、
 * 削除対象に含めない（screens.md 4.2 手順2）。
 * 期待文字列は作成側（spoiler-post.ts）と同じ関数で構築し、乖離を防ぐ。
 */
export function isMatchingAnnouncement(
  value: unknown,
  origin: string,
  did: string,
  rkey: string,
): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.$type !== ANNOUNCEMENT_COLLECTION) {
    return false;
  }
  if (typeof record.text !== "string") {
    return false;
  }
  const expectedText = buildAnnouncementText(buildDedicatedUrl(origin, did, rkey));
  return record.text === expectedText;
}

export type DeleteFailureReason = "invalid-rkey" | "swap-conflict" | "pds-error";

export type DeleteOutcome = { ok: true } | { ok: false; reason: DeleteFailureReason };

export interface DeleteSpoilerPostParams {
  /** 削除対象のリポジトリ（常にセッションのDID。要件: 自分のリポジトリのみ操作可能）。 */
  did: string;
  rkey: string;
  origin: string;
}

/**
 * 削除処理（screens.md 4.2）。
 *
 * 1. リポジトリの現在のコミットCIDを観測する（`swapCommit` の基準。TOCTOU対策）。
 *    これ以降の読み取り内容が正しく反映されるよう、読み取りより先に取得する
 *    （読み取り後に取得すると、読み取り中に起きた変更が基準に混ざり込み、
 *    `applyWrites` の競合検出が効かなくなるため）。
 * 2. 本文レコードを取得する。存在しなければ「すでに削除済み」として成功扱い。
 * 3. `announcementRkey` があれば案内投稿を取得し、固定テンプレートと一致するか検証する。
 *    存在しない・不一致の場合は削除対象に含めない。
 * 4. 手順1で観測したコミットCIDを `swapCommit` として `applyWrites` を呼ぶ。
 *    競合時は失敗として返す（自動リトライしない）。
 */
export async function deleteSpoilerPost(
  agent: RepoAgent,
  params: DeleteSpoilerPostParams,
): Promise<DeleteOutcome> {
  const { did, rkey, origin } = params;

  if (!isValidRecordKey(rkey)) {
    return { ok: false, reason: "invalid-rkey" };
  }

  // TOCTOU対策（screens.md 4.2 手順4）: これから行う読み取り（本文・案内投稿の確認）より
  // 前にリポジトリのコミットCIDを観測する。読み取り後に観測すると、読み取りとほぼ同時に
  // 発生した変更がswapCommitの基準に取り込まれてしまい、applyWritesの競合検出が
  // 読み取り自体の間に起きた変化を見逃す（チェック自体が無意味になる）ため、必ず先に取得する。
  let swapCommit: string;
  try {
    const commit = await agent.com.atproto.sync.getLatestCommit({ did });
    swapCommit = commit.data.cid;
  } catch {
    return { ok: false, reason: "pds-error" };
  }

  let spoilerValue: unknown;
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: SPOILER_COLLECTION,
      rkey,
    });
    spoilerValue = res.data.value;
  } catch (err) {
    if (isRecordNotFound(err)) {
      // すでに削除済み（screens.md 4.2 手順1）。
      return { ok: true };
    }
    return { ok: false, reason: "pds-error" };
  }

  const validated = validateSpoilerRecord(spoilerValue);
  const announcementRkey = validated?.announcementRkey ?? null;

  let announcementMatched = false;
  if (announcementRkey !== null) {
    try {
      const res = await agent.com.atproto.repo.getRecord({
        repo: did,
        collection: ANNOUNCEMENT_COLLECTION,
        rkey: announcementRkey,
      });
      announcementMatched = isMatchingAnnouncement(res.data.value, origin, did, rkey);
    } catch (err) {
      if (!isRecordNotFound(err)) {
        // 取得不可（ネットワーク障害等、存在しないと断定できないエラー）の場合は、
        // 本文レコードのみを削除する処理へ進めない。誤って「存在しない」とみなすと、
        // 実在する対応する案内投稿が二度と削除できなくなる（本文レコード削除後は
        // announcementRkeyの手がかりを失うため）。フォールバックせず明確に失敗させる。
        return { ok: false, reason: "pds-error" };
      }
      // 案内投稿がすでに手動削除されている → 本文レコードのみ削除する（screens.md 4.2 手順3）。
      announcementMatched = false;
    }
  }

  const writes: RepoDeleteWrite[] = [
    { $type: "com.atproto.repo.applyWrites#delete", collection: SPOILER_COLLECTION, rkey },
  ];
  if (announcementMatched && announcementRkey !== null) {
    writes.push({
      $type: "com.atproto.repo.applyWrites#delete",
      collection: ANNOUNCEMENT_COLLECTION,
      rkey: announcementRkey,
    });
  }

  try {
    await agent.com.atproto.repo.applyWrites({ repo: did, writes, swapCommit });
  } catch (err) {
    if (isInvalidSwap(err)) {
      // TOCTOU競合。自動リトライしない（AGENTS.md: フォールバック禁止）。
      return { ok: false, reason: "swap-conflict" };
    }
    return { ok: false, reason: "pds-error" };
  }

  return { ok: true };
}
