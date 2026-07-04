import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptFromBase64, encryptToBase64 } from "./oauth-crypto.js";

describe("oauth-crypto", () => {
  const key = randomBytes(32);

  it("暗号化→復号でラウンドトリップする", () => {
    const plaintext = JSON.stringify({ token: "secret-value", nested: { a: 1 } });
    const blob = encryptToBase64(plaintext, key);
    expect(decryptFromBase64(blob, key)).toBe(plaintext);
  });

  it("暗号文に平文が現れない", () => {
    const blob = encryptToBase64("very-secret-token", key);
    expect(blob).not.toContain("very-secret-token");
  });

  it("毎回異なるIVで異なる暗号文になる", () => {
    const a = encryptToBase64("same", key);
    const b = encryptToBase64("same", key);
    expect(a).not.toBe(b);
  });

  it("異なる鍵では復号できない", () => {
    const blob = encryptToBase64("payload", key);
    expect(() => decryptFromBase64(blob, randomBytes(32))).toThrow();
  });

  it("改ざんされた暗号文は認証タグ検証で失敗する", () => {
    const blob = encryptToBase64("payload", key);
    const buf = Buffer.from(blob, "base64");
    buf.writeUInt8(buf.readUInt8(buf.length - 1) ^ 0xff, buf.length - 1);
    expect(() => decryptFromBase64(buf.toString("base64"), key)).toThrow();
  });

  it("短すぎる入力を拒否する", () => {
    expect(() => decryptFromBase64(Buffer.alloc(4).toString("base64"), key)).toThrow();
  });
});
