import { describe, expect, it } from "vitest";
import {
  byteLength,
  computeCounterState,
  MAX_BYTES,
  queryElements,
  updateCounter,
} from "./compose.js";

describe("byteLength", () => {
  it("ASCII文字は1文字1バイト", () => {
    expect(byteLength("hello")).toBe(5);
  });

  it("マルチバイト文字（日本語）はUTF-8のバイト数で数える", () => {
    // 「あ」はUTF-8で3バイト。
    expect(byteLength("あ")).toBe(3);
    expect(byteLength("ネタバレ")).toBe(12);
  });

  it("空文字列は0バイト", () => {
    expect(byteLength("")).toBe(0);
  });
});

describe("computeCounterState", () => {
  it("上限未満では残りバイト数が正の値、overLimitはfalse", () => {
    const state = computeCounterState("hello");
    expect(state.remainingBytes).toBe(MAX_BYTES - 5);
    expect(state.overLimit).toBe(false);
  });

  it("ちょうど上限バイト数ではoverLimitはfalse", () => {
    const text = "a".repeat(MAX_BYTES);
    const state = computeCounterState(text);
    expect(state.remainingBytes).toBe(0);
    expect(state.overLimit).toBe(false);
  });

  it("上限を1バイトでも超えるとoverLimitはtrue", () => {
    const text = "a".repeat(MAX_BYTES + 1);
    const state = computeCounterState(text);
    expect(state.remainingBytes).toBe(-1);
    expect(state.overLimit).toBe(true);
  });

  it("approxCharsは残りバイト数から残り文字数の目安を切り捨てで算出する", () => {
    const empty = computeCounterState("");
    expect(empty.approxChars).toBe(2500); // floor(7500/3)

    const one = computeCounterState("a"); // 1バイト使用
    expect(one.approxChars).toBe(2499); // floor(7499/3)
  });

  it("上限超過時のapproxCharsは0に丸める", () => {
    const state = computeCounterState("a".repeat(MAX_BYTES + 10));
    expect(state.approxChars).toBe(0);
  });
});

describe("queryElements", () => {
  it("必要な要素がすべて揃っていれば取得する", () => {
    const elements = {
      "compose-text": { value: "" },
      "compose-counter-remaining": { textContent: "" },
      "compose-counter-chars": { textContent: "" },
      "compose-submit": { disabled: false },
    } as Record<string, unknown>;
    const root = { getElementById: (id: string) => elements[id] ?? null };

    const result = queryElements(root);
    expect(result).not.toBeNull();
  });

  it("いずれかの要素が欠けていればnullを返す（progressive enhancement）", () => {
    const root = { getElementById: () => null };
    expect(queryElements(root)).toBeNull();
  });
});

describe("updateCounter", () => {
  function buildElements(initialValue: string) {
    return {
      textarea: { value: initialValue, addEventListener: () => {} },
      remaining: { textContent: "" },
      chars: { textContent: "" },
      submit: { disabled: false },
    };
  }

  it("残りバイト数・文字数目安を反映し、上限内ではボタンを有効にする", () => {
    const elements = buildElements("hello");
    updateCounter(elements);
    expect(elements.remaining.textContent).toBe((MAX_BYTES - 5).toLocaleString("ja-JP"));
    expect(elements.submit.disabled).toBe(false);
  });

  it("上限超過時は送信ボタンを無効化する", () => {
    const elements = buildElements("a".repeat(MAX_BYTES + 1));
    updateCounter(elements);
    expect(elements.submit.disabled).toBe(true);
  });
});
