import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDenylistService, type DenylistService } from "./denylist.js";

let dir: string;
let file: string;
const services: DenylistService[] = [];

function write(content: string): void {
  fs.writeFileSync(file, content);
}

function make(logger?: (m: string) => void): DenylistService {
  // 大きなintervalで自動リロードを実質無効化し、reload()で明示的に確認する。
  const svc = createDenylistService(file, {
    intervalMs: 1_000_000,
    ...(logger ? { logger } : {}),
  });
  services.push(svc);
  return svc;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "skyseal-denylist-"));
  file = path.join(dir, "denylist.json");
});

afterEach(() => {
  for (const svc of services.splice(0)) {
    svc.stop();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("createDenylistService", () => {
  it("起動時にDID単位・レコード単位を読み込む", () => {
    write(
      JSON.stringify({
        dids: ["did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"],
        records: [{ did: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", rkey: "3zzz" }],
      }),
    );
    const svc = make();
    expect(svc.isDenied("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "anything")).toBe(true);
    expect(svc.isDenied("did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", "3zzz")).toBe(true);
    expect(svc.isDenied("did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", "other")).toBe(false);
    expect(svc.isDenied("did:plc:cccccccccccccccccccccccc", "3zzz")).toBe(false);
  });

  it("reloadで変更を反映する", () => {
    write(JSON.stringify({ dids: [], records: [] }));
    const svc = make();
    expect(svc.isDenied("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "x")).toBe(false);

    write(JSON.stringify({ dids: ["did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"], records: [] }));
    svc.reload();
    expect(svc.isDenied("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "x")).toBe(true);
  });

  it("不正なJSONは直前の有効なリストを維持しログに残す", () => {
    write(JSON.stringify({ dids: ["did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"], records: [] }));
    const logger = vi.fn();
    const svc = make(logger);
    expect(svc.isDenied("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "x")).toBe(true);

    write("{ this is not json");
    svc.reload();
    // 直前の有効リストを維持する。
    expect(svc.isDenied("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "x")).toBe(true);
    expect(logger).toHaveBeenCalled();
  });

  it("形式不正（型不整合）は直前の有効なリストを維持する", () => {
    write(JSON.stringify({ dids: ["did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"], records: [] }));
    const logger = vi.fn();
    const svc = make(logger);

    write(JSON.stringify({ dids: "not-an-array" }));
    svc.reload();
    expect(svc.isDenied("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "x")).toBe(true);
    expect(logger).toHaveBeenCalled();
  });

  it("dids/records省略時は空リストとして扱う", () => {
    write(JSON.stringify({}));
    const svc = make();
    expect(svc.isDenied("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "x")).toBe(false);
  });

  it("設定した間隔で自動再読み込みする", () => {
    vi.useFakeTimers();
    try {
      write(JSON.stringify({ dids: [], records: [] }));
      const svc = createDenylistService(file, { intervalMs: 60_000 });
      services.push(svc);
      expect(svc.isDenied("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "x")).toBe(false);

      write(JSON.stringify({ dids: ["did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"], records: [] }));
      vi.advanceTimersByTime(60_000);
      expect(svc.isDenied("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", "x")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
