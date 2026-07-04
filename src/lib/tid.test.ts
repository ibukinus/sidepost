import { describe, expect, it, vi } from "vitest";
import { isValidTid, nextTid } from "./tid.js";

describe("nextTid", () => {
  it("13文字のTID構文に適合する値を生成する", () => {
    const tid = nextTid();
    expect(isValidTid(tid)).toBe(true);
  });

  it("連続生成した値は文字列比較で単調増加する", () => {
    const values: string[] = [];
    for (let i = 0; i < 50; i++) {
      values.push(nextTid());
    }
    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1] as string;
      const cur = values[i] as string;
      expect(cur > prev).toBe(true);
    }
  });

  it("同一ミリ秒内で連続呼び出ししても単調増加する（時計解像度より高頻度の生成）", () => {
    const fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const a = nextTid();
      const b = nextTid();
      const c = nextTid();
      expect(b > a).toBe(true);
      expect(c > b).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("システム時刻が後退しても直前の値より大きい値を生成する", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);
    const later = nextTid();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000_000_000); // 時計巻き戻り
    const afterRollback = nextTid();
    vi.restoreAllMocks();
    expect(afterRollback > later).toBe(true);
  });

  it("同一ミリ秒内で1,000回を超えて生成しても、ミリ秒繰り上げ後の値が逆転しない", () => {
    // カウンタ相当の値が1,000を超えて次のミリ秒の範囲に達するバースト生成を再現する。
    const fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const values: string[] = [];
    for (let i = 0; i < 1500; i++) {
      values.push(nextTid());
    }
    // 次のミリ秒に進んでも、直前の値（繰り上げ済み）より大きい値になること。
    vi.spyOn(Date, "now").mockReturnValue(fixedNow + 1);
    const afterMsTick = nextTid();
    vi.restoreAllMocks();

    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1] as string;
      const cur = values[i] as string;
      expect(cur > prev).toBe(true);
    }
    expect(afterMsTick > (values[values.length - 1] as string)).toBe(true);
  });
});

describe("isValidTid", () => {
  it("生成したTIDを妥当と判定する", () => {
    expect(isValidTid(nextTid())).toBe(true);
  });

  it("長さが不正な値を拒否する", () => {
    expect(isValidTid("short")).toBe(false);
    expect(isValidTid("a".repeat(14))).toBe(false);
  });

  it("先頭文字が上位半分（k-z等）の値を拒否する（先頭1bitは常に0の制約）", () => {
    expect(isValidTid("zzzzzzzzzzzzz")).toBe(false);
  });

  it("大文字や許可されない記号を含む値を拒否する", () => {
    expect(isValidTid("3JZFCIJPJ2H2A")).toBe(false); // 大文字
    expect(isValidTid("3jzfcijpj2h2!")).toBe(false); // 記号
  });
});
