import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * OAuthセッション・stateの保存値を暗号化するためのAES-256-GCMユーティリティ
 * （oauth-session.md 4.、architecture.md 4.）。
 *
 * 鍵は `SKYSEAL_ENCRYPTION_KEY`（32バイト）をそのまま用いる。保存形式は
 * `base64( iv(12B) || authTag(16B) || ciphertext )` の単一文字列で、SQLiteの
 * TEXTカラムにそのまま格納できる。
 *
 * トークン等の平文はこのモジュール外へ出さない（ログ・例外メッセージへ含めない）。
 */

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ALGORITHM = "aes-256-gcm";

export function encryptToBase64(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptFromBase64(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error("暗号文が不正です（長さ不足）");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
