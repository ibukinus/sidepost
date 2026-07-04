/**
 * AT Protocol の TID（Timestamp Identifier）生成（lexicon.md 1.、要件6.5）。
 *
 * 仕様（atproto.com/specs/tid）: 64bit値（先頭1bitは常に0 + 53bitのマイクロ秒
 * タイムスタンプ + 10bitのclock id）を、13文字のbase32-sortable文字列に
 * エンコードしたもの。文字列としての大小比較が生成順と一致する。
 *
 * `@atproto/api` はTIDの構文検証（`isValidTid` 相当）のみを再輸出しており、
 * 生成ロジックは公開APIとして提供していない（transitiveな `@atproto/common-web`
 * には実装があるが、直接依存ではないため利用しない）。そのため本モジュールで
 * 仕様通りに自前実装する。
 *
 * 単調増加の保証:
 * - プロセス内で直前に生成したタイムスタンプ値（ミリ秒×1000+同一ミリ秒内カウンタ相当の
 *   マイクロ秒風の値）をモジュール状態として保持し、次の値は
 *   `max(現在時刻由来の値, 直前の値+1)` として計算する。
 * - この式により、システム時刻の後退時（`Date.now()`が巻き戻る）だけでなく、
 *   同一ミリ秒内に1,000回を超えて連続生成した場合（バースト生成でミリ秒の桁を
 *   繰り上げるケース）でも、直前の値+1以上になることが保証され、既存値の再現・
 *   逆転は起こらない。
 * - 投稿作成（POST /compose）では本文レコード用・案内投稿用の2つのTIDを同期的に
 *   連続生成するため、この保証で十分（呼び出し間に `await` を挟まないこと）。
 */

const S32_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
const TID_LENGTH = 13;
const TIMESTAMP_CHARS = 11; // 55bit分（実際に使うのは53bit）
const CLOCK_ID_CHARS = 2; // 10bit分

// 先頭1bitは常に0という制約から、先頭文字は takes on the low half of the alphabet
// （5bit中の上位1bitが0になる16文字）に限られる。
const TID_REGEX = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

function s32encode(value: number, length: number): string {
  let out = "";
  let n = value;
  for (let i = 0; i < length; i++) {
    const charIndex = n % 32;
    out = S32_ALPHABET[charIndex] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

let lastTimestamp = 0;
let clockId: number | null = null;

function getClockId(): number {
  if (clockId === null) {
    // 10bit（0〜1023）。プロセスごとに1回だけランダムに決め、以後は固定する。
    clockId = Math.floor(Math.random() * 1024);
  }
  return clockId;
}

/**
 * 新しいTIDを生成する。
 *
 * 時刻はミリ秒精度の `Date.now()` を基にマイクロ秒相当の値（×1000）へ変換し、
 * 「直前に生成した値+1」との大きい方を採用する。これにより、システム時刻の後退時、
 * および同一ミリ秒内での高頻度な連続呼び出し（1,000回/ミリ秒を超える場合を含む）
 * のいずれでも、直前に生成した値より必ず大きい値になる。
 */
export function nextTid(): string {
  const nowTimestamp = Date.now() * 1000;
  const timestamp = Math.max(nowTimestamp, lastTimestamp + 1);
  lastTimestamp = timestamp;

  return `${s32encode(timestamp, TIMESTAMP_CHARS)}${s32encode(getClockId(), CLOCK_ID_CHARS)}`;
}

/** TIDの構文（13文字、base32-sortable、先頭文字は上位1bitが0の範囲）に適合するか。 */
export function isValidTid(input: string): boolean {
  return input.length === TID_LENGTH && TID_REGEX.test(input);
}
