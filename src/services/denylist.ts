import * as fs from "node:fs";

/**
 * 表示停止リスト（content-api.md 4.、要件6.9）。
 *
 * `SKYSEAL_DENYLIST_PATH` のJSONファイルを起動時に読み込み、以後60秒間隔で
 * 再読み込みする（再起動不要で反映）。ファイル形式が不正な場合は直前の有効な
 * リストを維持し、エラーをログに残す（content-api.md 4. 明記の挙動）。
 *
 * 保存するのは識別子のみで、対象本文は保存しない（要件7.2）。
 * 後続の /p/ ページ（Phase 3b）でも再利用できるようexportする。
 */

const DEFAULT_RELOAD_INTERVAL_MS = 60_000;

export interface DenylistService {
  /** DID単位またはDID+rkey単位で表示停止対象かを判定する。 */
  isDenied(did: string, rkey: string): boolean;
  /** ファイルを即時再読み込みする（主にテスト用）。 */
  reload(): void;
  /** 定期再読み込みタイマーを停止する。 */
  stop(): void;
}

export interface CreateDenylistServiceOptions {
  /** 再読み込み間隔（ミリ秒）。既定値: 60000 */
  intervalMs?: number;
  /** エラーログ出力先。既定値: console.error。本文・レコード内容は渡さない */
  logger?: (message: string) => void;
}

interface DenylistState {
  dids: Set<string>;
  records: Set<string>;
}

/** レコード単位のキー。DIDに改行は含まれず、rkey構文も改行を許さないため衝突しない。 */
function recordKey(did: string, rkey: string): string {
  return `${did}\n${rkey}`;
}

/**
 * 表示停止リストサービスを生成する。生成時に一度読み込み、以後は間隔ごとに再読み込みする。
 */
export function createDenylistService(
  path: string,
  options: CreateDenylistServiceOptions = {},
): DenylistService {
  const intervalMs = options.intervalMs ?? DEFAULT_RELOAD_INTERVAL_MS;
  const log = options.logger ?? ((message: string) => console.error(message));

  let state: DenylistState = { dids: new Set(), records: new Set() };

  function load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(path, "utf8");
    } catch {
      log("denylist: ファイルの読み込みに失敗しました（直前のリストを維持）");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log("denylist: JSONの解析に失敗しました（直前のリストを維持）");
      return;
    }

    const next = parseDenylist(parsed);
    if (next === null) {
      log("denylist: ファイル形式が不正です（直前のリストを維持）");
      return;
    }
    state = next;
  }

  load();

  const timer = setInterval(load, intervalMs);
  timer.unref?.();

  return {
    isDenied(did: string, rkey: string): boolean {
      return state.dids.has(did) || state.records.has(recordKey(did, rkey));
    },
    reload: load,
    stop(): void {
      clearInterval(timer);
    },
  };
}

/**
 * denylistのJSONを検証して内部状態に変換する。不正な形式は `null` を返す。
 * `dids` / `records` は省略時に空として扱うが、存在する場合の型不整合は不正とする。
 */
function parseDenylist(value: unknown): DenylistState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;

  const dids = new Set<string>();
  if (obj.dids !== undefined) {
    if (!Array.isArray(obj.dids)) {
      return null;
    }
    for (const entry of obj.dids) {
      if (typeof entry !== "string" || entry.length === 0) {
        return null;
      }
      dids.add(entry);
    }
  }

  const records = new Set<string>();
  if (obj.records !== undefined) {
    if (!Array.isArray(obj.records)) {
      return null;
    }
    for (const entry of obj.records) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return null;
      }
      const rec = entry as Record<string, unknown>;
      if (
        typeof rec.did !== "string" ||
        rec.did.length === 0 ||
        typeof rec.rkey !== "string" ||
        rec.rkey.length === 0
      ) {
        return null;
      }
      records.add(recordKey(rec.did, rec.rkey));
    }
  }

  return { dids, records };
}
