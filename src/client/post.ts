/**
 * 投稿表示画面（`/p/{did}/{rkey}`）のクライアントJS（screens.md 3.4）。
 * esbuildで `public/assets/js/post.js` にバンドルする。
 *
 * 同一オリジンの `GET /api/p/{did}/{rkey}` をfetchし、本文・投稿者情報・投稿日時・
 * 案内投稿リンクを描画する。本文の描画は `textContent` 代入のみで行い、
 * HTMLとして解釈しない（innerHTML禁止。改行はCSSの `white-space: pre-wrap` で保持）。
 *
 * DOM操作から独立させたロジック（レスポンス検証・状態分類・表示名選択・日時整形）は
 * 純関数としてexportし、単体テスト可能にしている。
 */

export interface SpoilerAuthor {
  did: string;
  handle?: string;
  displayName?: string;
}

export interface SpoilerResponse {
  text: string;
  createdAt: string;
  author: SpoilerAuthor;
  announcementUrl: string;
}

export type PostViewState =
  | { kind: "success"; data: SpoilerResponse }
  | { kind: "unavailable" }
  | { kind: "rate-limited" }
  | { kind: "error" };

const UNAVAILABLE_MESSAGE = "この投稿は表示できません。";
const RATE_LIMITED_MESSAGE =
  "アクセスが集中しています。しばらく時間をおいてから再読み込みしてください。";
const ERROR_MESSAGE = "本文を取得できませんでした。時間をおいて再読み込みしてください。";

/**
 * `GET /api/p/{did}/{rkey}` の成功レスポンスJSONを検証する（content-api.md 1.）。
 * 自サービスのAPIだが、描画前に形状を確認してから使う。
 */
export function parseSpoilerResponse(value: unknown): SpoilerResponse | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.text !== "string" ||
    typeof obj.createdAt !== "string" ||
    typeof obj.announcementUrl !== "string"
  ) {
    return null;
  }
  if (typeof obj.author !== "object" || obj.author === null) {
    return null;
  }
  const authorObj = obj.author as Record<string, unknown>;
  if (typeof authorObj.did !== "string") {
    return null;
  }

  const author: SpoilerAuthor = { did: authorObj.did };
  if (typeof authorObj.handle === "string") {
    author.handle = authorObj.handle;
  }
  if (typeof authorObj.displayName === "string") {
    author.displayName = authorObj.displayName;
  }

  return {
    text: obj.text,
    createdAt: obj.createdAt,
    announcementUrl: obj.announcementUrl,
    author,
  };
}

/** 表示名優先、なければハンドル、どちらもなければDIDを表示する（screens.md 3.4）。 */
export function pickAuthorLabel(author: SpoilerAuthor): string {
  if (author.displayName) {
    return author.displayName;
  }
  if (author.handle) {
    return author.handle;
  }
  return author.did;
}

/** 投稿日時をロケール依存の読みやすい形式に整形する。解析できなければISO文字列をそのまま返す。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** HTTPレスポンスを表示用の状態に分類する（screens.md 3.4: 200/404/429/その他）。 */
export async function classifyResponse(res: Response): Promise<PostViewState> {
  if (res.status === 200) {
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { kind: "error" };
    }
    const data = parseSpoilerResponse(json);
    return data === null ? { kind: "error" } : { kind: "success", data };
  }
  if (res.status === 404) {
    return { kind: "unavailable" };
  }
  if (res.status === 429) {
    return { kind: "rate-limited" };
  }
  return { kind: "error" };
}

/** 表示不可状態（success以外）に対応する固定メッセージ。 */
export function messageForState(state: Exclude<PostViewState, { kind: "success" }>): string {
  switch (state.kind) {
    case "unavailable":
      return UNAVAILABLE_MESSAGE;
    case "rate-limited":
      return RATE_LIMITED_MESSAGE;
    case "error":
      return ERROR_MESSAGE;
  }
}

// tsconfig.json は他フェーズと共有するサーバー向け設定であり、"dom" libを追加すると
// 既存のNode向けfetch型と衝突するため変更しない。代わりにこのファイル内だけで
// 必要最小限のDOM風アンビエント型を自前で宣言する（実行はesbuildがそのままバンドル
// するため、型定義がなくても動作には影響しない）。
type ElementLike = object;

interface QueryableRoot {
  querySelector(selector: string): ElementLike | null;
}

interface DocumentLike extends QueryableRoot {
  readyState: string;
  addEventListener(type: string, listener: () => void): void;
}

declare const document: DocumentLike | undefined;

/** SSRが埋め込んだプレースホルダ要素一式。いずれかが欠けていれば `null`。 */
export interface PostPageElements {
  section: { dataset: { postDid?: string; postRkey?: string } };
  status: { hidden: boolean; textContent: string };
  body: { hidden: boolean };
  text: { textContent: string };
  author: { textContent: string };
  createdAt: { textContent: string; setAttribute(name: string, value: string): void };
  announcementLink: { href: string; hidden: boolean };
}

/** `root` からプレースホルダ要素一式を取得する。1つでも見つからなければ `null`。 */
export function queryElements(root: QueryableRoot): PostPageElements | null {
  const section = root.querySelector(".post-page[data-post-did][data-post-rkey]");
  const status = root.querySelector('[data-role="status"]');
  const body = root.querySelector('[data-role="body"]');
  const text = root.querySelector('[data-role="text"]');
  const author = root.querySelector('[data-role="author"]');
  const createdAt = root.querySelector('[data-role="created-at"]');
  const announcementLink = root.querySelector('[data-role="announcement-link"]');
  if (!section || !status || !body || !text || !author || !createdAt || !announcementLink) {
    return null;
  }
  return {
    section: section as unknown as PostPageElements["section"],
    status: status as unknown as PostPageElements["status"],
    body: body as unknown as PostPageElements["body"],
    text: text as unknown as PostPageElements["text"],
    author: author as unknown as PostPageElements["author"],
    createdAt: createdAt as unknown as PostPageElements["createdAt"],
    announcementLink: announcementLink as unknown as PostPageElements["announcementLink"],
  };
}

/**
 * 状態に応じてプレースホルダ要素を更新する。本文・投稿者名はすべて `textContent`
 * 代入のみで行い、HTMLとして解釈しない（要件7.3）。
 */
export function renderState(elements: PostPageElements, state: PostViewState): void {
  if (state.kind === "success") {
    elements.text.textContent = state.data.text;
    elements.author.textContent = pickAuthorLabel(state.data.author);
    elements.createdAt.textContent = formatDateTime(state.data.createdAt);
    elements.createdAt.setAttribute("datetime", state.data.createdAt);
    elements.announcementLink.href = state.data.announcementUrl;
    elements.announcementLink.hidden = false;
    elements.body.hidden = false;
    elements.status.hidden = true;
    elements.status.textContent = "";
    return;
  }
  elements.body.hidden = true;
  elements.status.hidden = false;
  elements.status.textContent = messageForState(state);
}

async function init(doc: DocumentLike): Promise<void> {
  const elements = queryElements(doc);
  if (elements === null) {
    return;
  }
  const did = elements.section.dataset.postDid;
  const rkey = elements.section.dataset.postRkey;
  if (!did || !rkey) {
    return;
  }

  let state: PostViewState;
  try {
    // did・rkeyはSSR側でatproto構文検証済みの値であり、URL区切り文字を含まないため
    // そのままパスセグメントとして組み立てる。
    const res = await fetch(`/api/p/${did}/${rkey}`, {
      headers: { accept: "application/json" },
    });
    state = await classifyResponse(res);
  } catch {
    state = { kind: "error" };
  }
  renderState(elements, state);
}

if (typeof document !== "undefined") {
  const doc = document;
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", () => {
      void init(doc);
    });
  } else {
    void init(doc);
  }
}
