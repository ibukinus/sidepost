import { describe, expect, it } from "vitest";
import {
  isValidDatetime,
  isValidHandle,
  isValidRecordKey,
  parseDid,
  utf8ByteLength,
} from "./atproto-syntax.js";

describe("parseDid", () => {
  it("有効な did:plc を解析する", () => {
    const did = "did:plc:abcdefghijklmnopqrstuvwx";
    expect(parseDid(did)).toEqual({ method: "plc", did });
  });

  it("長さ・文字が不正な did:plc を拒否する", () => {
    expect(parseDid("did:plc:short")).toBeNull();
    expect(parseDid("did:plc:ABCDEFGHIJKLMNOPQRSTUVWX")).toBeNull(); // 大文字不可
    expect(parseDid("did:plc:abcdefghijklmnopqrstuvw1")).toBeNull(); // '1' は base32 対象外
  });

  it("ホスト名のみの did:web を解析する", () => {
    expect(parseDid("did:web:example.com")).toEqual({
      method: "web",
      did: "did:web:example.com",
      host: "example.com",
    });
  });

  it("ポート付き did:web（%3A エンコード）を解析する", () => {
    const parsed = parseDid("did:web:example.com%3A3000");
    expect(parsed).toEqual({
      method: "web",
      did: "did:web:example.com%3A3000",
      host: "example.com:3000",
    });
  });

  it("path-based did:web（コロン区切り）を拒否する", () => {
    expect(parseDid("did:web:example.com:user:alice")).toBeNull();
  });

  it("空・不正な did:web を拒否する", () => {
    expect(parseDid("did:web:")).toBeNull();
    expect(parseDid("did:web:exa mple.com")).toBeNull();
  });

  it("対応外のDIDメソッドを拒否する", () => {
    expect(parseDid("did:key:z6Mk")).toBeNull();
    expect(parseDid("did:example:123")).toBeNull();
    expect(parseDid("not-a-did")).toBeNull();
  });
});

describe("isValidRecordKey", () => {
  it("有効なrecord-keyを受理する", () => {
    expect(isValidRecordKey("3juf5s2xku2v")).toBe(true);
    expect(isValidRecordKey("self")).toBe(true);
    expect(isValidRecordKey("a.b_c-d~e:f")).toBe(true);
  });

  it("不正なrecord-keyを拒否する", () => {
    expect(isValidRecordKey("")).toBe(false);
    expect(isValidRecordKey(".")).toBe(false);
    expect(isValidRecordKey("..")).toBe(false);
    expect(isValidRecordKey("has space")).toBe(false);
    expect(isValidRecordKey("slash/no")).toBe(false);
    expect(isValidRecordKey("a".repeat(513))).toBe(false);
  });
});

describe("isValidDatetime", () => {
  it("有効なdatetimeを受理する", () => {
    expect(isValidDatetime("2026-07-04T00:00:00.000Z")).toBe(true);
    expect(isValidDatetime("1985-04-12T23:20:50.123+01:45")).toBe(true);
    expect(isValidDatetime("2026-07-04T00:00:00Z")).toBe(true);
  });

  it("タイムゾーンなし・-00:00・不正な形式を拒否する", () => {
    expect(isValidDatetime("2026-07-04T00:00:00")).toBe(false);
    expect(isValidDatetime("2026-07-04T00:00:00-00:00")).toBe(false);
    expect(isValidDatetime("2026-07-04")).toBe(false);
    expect(isValidDatetime("not-a-date")).toBe(false);
    expect(isValidDatetime("2026-13-04T00:00:00Z")).toBe(false);
  });

  it("暦日として存在しない日付（2月31日等）を拒否する", () => {
    expect(isValidDatetime("2026-02-31T00:00:00.000Z")).toBe(false);
    expect(isValidDatetime("2026-04-31T00:00:00.000Z")).toBe(false);
    // うるう年でない年の2月29日
    expect(isValidDatetime("2027-02-29T00:00:00.000Z")).toBe(false);
    // うるう年の2月29日は有効
    expect(isValidDatetime("2028-02-29T00:00:00.000Z")).toBe(true);
  });
});

describe("isValidHandle", () => {
  it("有効なハンドルを受理する", () => {
    expect(isValidHandle("alice.example.com")).toBe(true);
    expect(isValidHandle("a.bsky.social")).toBe(true);
  });

  it("不正なハンドルを拒否する", () => {
    expect(isValidHandle("")).toBe(false);
    expect(isValidHandle("nodot")).toBe(false);
    expect(isValidHandle("-bad.example.com")).toBe(false);
  });
});

describe("utf8ByteLength", () => {
  it("UTF-8バイト長を返す", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("あ")).toBe(3);
    expect(utf8ByteLength("")).toBe(0);
  });
});
