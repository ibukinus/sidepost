import type { LookupAddress } from "node:dns";
import * as dns from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import { isDisallowedAddress } from "./ip.js";

/**
 * SSRF対策済みの外部HTTPSリクエストユーティリティ。
 *
 * content-api.md 6. の要求を実装する:
 * - スキームはhttpsのみ許可
 * - 名前解決結果がプライベートIP等の場合は接続しない
 * - DNS rebinding対策として、検証したIPに対して直接接続する
 * - リダイレクトは自動追従しない
 * - 合計タイムアウトを設ける
 * - レスポンスサイズに上限を設ける
 *
 * DID解決・PDSアクセス・OAuthの外部リクエストは、すべてこの関数を経由すること。
 */

export type SafeFetchErrorReason =
  | "invalid-url"
  | "disallowed-scheme"
  | "dns-resolution-failed"
  | "disallowed-address"
  | "timeout"
  | "response-too-large"
  | "network-error";

export class SafeFetchError extends Error {
  readonly reason: SafeFetchErrorReason;

  constructor(reason: SafeFetchErrorReason, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.reason = reason;
  }
}

export interface SafeFetchOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** 合計タイムアウト（DNS解決〜応答受信完了まで）。既定値: 5000ms */
  timeoutMs?: number;
  /** レスポンスボディの上限バイト数。既定値: 5MB */
  maxResponseBytes?: number;
}

export interface SafeFetchResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** `new URL(...).hostname` はIPv6リテラルを `[::1]` のように角括弧付きで返すため取り除く */
function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

async function resolveAddress(rawHostname: string): Promise<ResolvedAddress> {
  const hostname = stripIpv6Brackets(rawHostname);
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return { address: hostname, family: literalFamily };
  }

  let results: LookupAddress[];
  try {
    results = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError("dns-resolution-failed", `DNS解決に失敗しました: ${hostname}`);
  }
  const first = results[0];
  if (!first) {
    throw new SafeFetchError("dns-resolution-failed", `DNS解決結果が空でした: ${hostname}`);
  }
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

/**
 * `signal` が中断された時点で拒否されるPromise。
 * `dns.lookup` はAbortSignalを認識しないため、DNS解決中に合計タイムアウトを
 * 効かせるには `Promise.race` で明示的に競走させる必要がある。
 */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const onAbort = () => reject(new SafeFetchError("timeout", "タイムアウトしました（DNS解決）"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * SSRF対策済みのHTTPSリクエストを実行する。
 * 名前解決で得たIPを検証し、実際の接続もその検証済みIPに対して直接行うため、
 * DNS rebinding（検証後の再解決によるすり替え）は発生しない。
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("invalid-url", `不正なURLです: ${rawUrl}`);
  }

  if (url.protocol !== "https:") {
    throw new SafeFetchError("disallowed-scheme", `httpsのみ許可されています: ${url.protocol}`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const resolved = await Promise.race([
      resolveAddress(url.hostname),
      rejectOnAbort(controller.signal),
    ]);
    if (isDisallowedAddress(resolved.address)) {
      throw new SafeFetchError(
        "disallowed-address",
        `接続が許可されていないアドレスです: ${resolved.address}`,
      );
    }

    return await performRequest(url, resolved, options, controller.signal, maxResponseBytes);
  } finally {
    clearTimeout(timeoutTimer);
  }
}

function performRequest(
  url: URL,
  resolved: ResolvedAddress,
  options: SafeFetchOptions,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<SafeFetchResult> {
  return new Promise((resolve, reject) => {
    let tooLarge = false;

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? "GET",
        headers: options.headers,
        signal,
        // 事前に検証したIPへ直接接続する（DNS rebinding対策）。
        // hostnameはSNI・Hostヘッダの算出に使われ、実際の接続先はここで固定する。
        lookup: (_hostname, _lookupOptions, callback) => {
          callback(null, resolved.address, resolved.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;

        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxResponseBytes) {
            tooLarge = true;
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          if (tooLarge) {
            return;
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    req.on("error", (err) => {
      if (tooLarge) {
        reject(
          new SafeFetchError(
            "response-too-large",
            `レスポンスサイズが上限（${maxResponseBytes}バイト）を超えました`,
          ),
        );
        return;
      }
      if (signal.aborted) {
        reject(new SafeFetchError("timeout", "タイムアウトしました"));
        return;
      }
      reject(new SafeFetchError("network-error", err.message));
    });

    if (options.body !== undefined) {
      req.end(options.body);
    } else {
      req.end();
    }
  });
}
