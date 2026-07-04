/**
 * 投稿画面のクライアントJS（screens.md 3.2、要件6.2）。
 * esbuildで `public/assets/js/compose.js` にバンドルする。
 *
 * `TextEncoder` でUTF-8バイト数を数え、残りバイト数と文字数換算の目安を表示する。
 * 7,500バイトを超えた場合は送信ボタンを無効化する（あくまで補助。正はサーバー側検証）。
 * JS無効環境でも投稿自体は成立する（progressive enhancement）。本文をこのファイルの
 * 外（ログ・分析等）へ送出する処理は一切行わない。
 *
 * DOM操作から独立させたロジック（バイト数計算・状態算出）は純関数としてexportし、
 * 単体テスト可能にしている。
 *
 * 注意: 上限値はサーバー側 `src/services/spoiler-post.ts` の `SPOILER_TEXT_MAX_BYTES` と
 * 一致させること。
 */

export const MAX_BYTES = 7500;
// 全角文字1文字あたり最大3バイト（BMP範囲）を仮定した換算係数。この仮定での
// 「残り入力可能な文字数」の下限目安を出す。あくまで目安であり、正確な文字数は
// UTF-8バイト数から一意に決まらない。SSR初期表示（compose-form.tsx）も同じ係数を使う。
export const APPROX_BYTES_PER_CHAR = 3;

/** UTF-8バイト数を数える。`TextEncoder` はNode・ブラウザ双方のグローバルに存在する。 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export interface ComposeCounterState {
  remainingBytes: number;
  approxChars: number;
  overLimit: boolean;
}

/** 本文から残りバイト数・残り文字数換算の目安・上限超過の有無を算出する。 */
export function computeCounterState(text: string): ComposeCounterState {
  const bytes = byteLength(text);
  const remainingBytes = MAX_BYTES - bytes;
  return {
    remainingBytes,
    // 「残り入力可能量」の文字数換算。上限超過時は0に丸める。
    approxChars: Math.max(0, Math.floor(remainingBytes / APPROX_BYTES_PER_CHAR)),
    overLimit: remainingBytes < 0,
  };
}

// tsconfig.json は他フェーズと共有するサーバー向け設定であり、"dom" libを追加すると
// 既存のNode向けfetch型と衝突するため変更しない。代わりにこのファイル内だけで
// 必要最小限のDOM風アンビエント型を自前で宣言する（実行はesbuildがそのままバンドル
// するため、型定義がなくても動作には影響しない）。
interface ElementLike {
  textContent: string;
}

interface TextAreaLike {
  value: string;
  addEventListener(type: string, listener: () => void): void;
}

interface ButtonLike {
  disabled: boolean;
}

interface QueryableRoot {
  getElementById(id: string): unknown;
}

interface DocumentLike extends QueryableRoot {
  readyState: string;
  addEventListener(type: string, listener: () => void): void;
}

declare const document: DocumentLike | undefined;

export interface ComposeFormElements {
  textarea: TextAreaLike;
  remaining: ElementLike;
  chars: ElementLike;
  submit: ButtonLike;
}

/**
 * `root` から投稿フォームの要素一式を取得する。1つでも見つからなければ `null`
 * （フォームのマークアップが想定と異なる場合、progressive enhancementとして
 * 何もしないことで、サーバー側検証だけの投稿を妨げない）。
 */
export function queryElements(root: QueryableRoot): ComposeFormElements | null {
  const textarea = root.getElementById("compose-text");
  const remaining = root.getElementById("compose-counter-remaining");
  const chars = root.getElementById("compose-counter-chars");
  const submit = root.getElementById("compose-submit");
  if (!textarea || !remaining || !chars || !submit) {
    return null;
  }
  return {
    textarea: textarea as unknown as TextAreaLike,
    remaining: remaining as unknown as ElementLike,
    chars: chars as unknown as ElementLike,
    submit: submit as unknown as ButtonLike,
  };
}

/** カウンタ表示と送信ボタンの有効/無効を更新する。 */
export function updateCounter(elements: ComposeFormElements): void {
  const state = computeCounterState(elements.textarea.value);
  elements.remaining.textContent = state.remainingBytes.toLocaleString("ja-JP");
  elements.chars.textContent = state.approxChars.toLocaleString("ja-JP");
  elements.submit.disabled = state.overLimit;
}

function init(doc: DocumentLike): void {
  const elements = queryElements(doc);
  if (elements === null) {
    return;
  }
  elements.textarea.addEventListener("input", () => updateCounter(elements));
  updateCounter(elements);
}

if (typeof document !== "undefined") {
  const doc = document;
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", () => init(doc));
  } else {
    init(doc);
  }
}
