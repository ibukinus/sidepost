import { describe, expect, it } from "vitest";
import {
  classifyResponse,
  formatDateTime,
  messageForState,
  type PostPageElements,
  parseSpoilerResponse,
  pickAuthorLabel,
  queryElements,
  renderState,
  type SpoilerResponse,
} from "./post.js";

const sample: SpoilerResponse = {
  text: "ネタバレ本文\n続き",
  createdAt: "2026-07-04T00:00:00.000Z",
  author: {
    did: "did:plc:abcdefghijklmnopqrstuvwx",
    handle: "alice.example.com",
    displayName: "Alice",
  },
  announcementUrl: "https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx/post/3announcement",
};

describe("parseSpoilerResponse", () => {
  it("有効なレスポンスを受理する", () => {
    expect(parseSpoilerResponse(sample)).toEqual(sample);
  });

  it("handle・displayNameが省略されていても受理する", () => {
    const minimal = { ...sample, author: { did: sample.author.did } };
    expect(parseSpoilerResponse(minimal)).toEqual(minimal);
  });

  it("必須フィールド欠如は拒否する", () => {
    expect(parseSpoilerResponse({ ...sample, text: undefined })).toBeNull();
    expect(parseSpoilerResponse({ ...sample, author: undefined })).toBeNull();
    expect(parseSpoilerResponse({ ...sample, author: {} })).toBeNull();
  });

  it("オブジェクトでない値・nullを拒否する", () => {
    expect(parseSpoilerResponse(null)).toBeNull();
    expect(parseSpoilerResponse("text")).toBeNull();
    expect(parseSpoilerResponse(42)).toBeNull();
  });
});

describe("pickAuthorLabel", () => {
  it("displayNameを優先する", () => {
    expect(pickAuthorLabel(sample.author)).toBe("Alice");
  });

  it("displayNameがなければhandle", () => {
    expect(pickAuthorLabel({ did: "did:plc:x", handle: "bob.example.com" })).toBe(
      "bob.example.com",
    );
  });

  it("どちらもなければDID", () => {
    expect(pickAuthorLabel({ did: "did:plc:x" })).toBe("did:plc:x");
  });
});

describe("formatDateTime", () => {
  it("ISO日時を読める形式に整形する", () => {
    const formatted = formatDateTime("2026-07-04T00:00:00.000Z");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).not.toBe("2026-07-04T00:00:00.000Z");
  });

  it("不正な日時はそのまま返す", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("classifyResponse", () => {
  it("200かつ有効な本文はsuccess", async () => {
    const res = new Response(JSON.stringify(sample), { status: 200 });
    expect(await classifyResponse(res)).toEqual({ kind: "success", data: sample });
  });

  it("200だが形式不正ならerror", async () => {
    const res = new Response(JSON.stringify({ foo: "bar" }), { status: 200 });
    expect(await classifyResponse(res)).toEqual({ kind: "error" });
  });

  it("200だがJSONとして解析できなければerror", async () => {
    const res = new Response("not json", { status: 200 });
    expect(await classifyResponse(res)).toEqual({ kind: "error" });
  });

  it("404はunavailable", async () => {
    const res = new Response(JSON.stringify({ error: "unavailable" }), { status: 404 });
    expect(await classifyResponse(res)).toEqual({ kind: "unavailable" });
  });

  it("429はrate-limited", async () => {
    const res = new Response(null, { status: 429 });
    expect(await classifyResponse(res)).toEqual({ kind: "rate-limited" });
  });

  it("それ以外のステータスはerror", async () => {
    const res = new Response(null, { status: 500 });
    expect(await classifyResponse(res)).toEqual({ kind: "error" });
  });
});

describe("messageForState", () => {
  it("状態ごとに固定メッセージを返す", () => {
    expect(messageForState({ kind: "unavailable" })).toBe("この投稿は表示できません。");
    expect(messageForState({ kind: "rate-limited" })).toContain("集中");
    expect(messageForState({ kind: "error" })).toContain("時間をおいて");
  });
});

/** テスト用の最小限のDOM要素スタブ。 */
function makeElements(): PostPageElements {
  return {
    section: { dataset: { postDid: "did:plc:x", postRkey: "3rkey" } },
    status: { hidden: false, textContent: "読み込み中です…" },
    body: { hidden: true },
    text: { textContent: "" },
    author: { textContent: "" },
    createdAt: { textContent: "", setAttribute: () => {} },
    announcementLink: { href: "", hidden: true },
  };
}

describe("renderState", () => {
  it("successならプレースホルダに本文・投稿者・日時・リンクを設定する", () => {
    const elements = makeElements();
    renderState(elements, { kind: "success", data: sample });

    expect(elements.text.textContent).toBe(sample.text);
    expect(elements.author.textContent).toBe("Alice");
    expect(elements.createdAt.textContent.length).toBeGreaterThan(0);
    expect(elements.announcementLink.href).toBe(sample.announcementUrl);
    expect(elements.announcementLink.hidden).toBe(false);
    expect(elements.body.hidden).toBe(false);
    expect(elements.status.hidden).toBe(true);
  });

  it("unavailable/rate-limited/errorは本文を隠したまま固定メッセージを表示する", () => {
    for (const state of [
      { kind: "unavailable" as const },
      { kind: "rate-limited" as const },
      { kind: "error" as const },
    ]) {
      const elements = makeElements();
      renderState(elements, state);
      expect(elements.body.hidden).toBe(true);
      expect(elements.status.hidden).toBe(false);
      expect(elements.status.textContent).toBe(messageForState(state));
      // 本文はどの要素にも書き込まれない。
      expect(elements.text.textContent).toBe("");
    }
  });
});

describe("queryElements", () => {
  function stubElement(): object {
    return {};
  }

  it("必要な要素がすべて揃っていれば取得できる", () => {
    const map: Record<string, object> = {
      ".post-page[data-post-did][data-post-rkey]": stubElement(),
      '[data-role="status"]': stubElement(),
      '[data-role="body"]': stubElement(),
      '[data-role="text"]': stubElement(),
      '[data-role="author"]': stubElement(),
      '[data-role="created-at"]': stubElement(),
      '[data-role="announcement-link"]': stubElement(),
    };
    const root = { querySelector: (selector: string) => map[selector] ?? null };

    const elements = queryElements(root);
    expect(elements).not.toBeNull();
    expect(elements?.section).toBe(map[".post-page[data-post-did][data-post-rkey]"]);
  });

  it("いずれか1つでも欠けていればnull", () => {
    const root = { querySelector: () => null };
    expect(queryElements(root)).toBeNull();
  });
});
