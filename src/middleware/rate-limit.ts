import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import {
  createTrustedProxyChecker,
  resolveClientIp,
  type TrustedProxyChecker,
} from "../lib/client-ip.js";
import type { AppEnv } from "../types.js";

/**
 * インメモリ・トークンバケットのレート制限（content-api.md 5.、要件7.3）。
 *
 * - クライアントIPごと: 30リクエスト/分
 * - プロセス全体: 300リクエスト/分（PDS・plc.directoryへの過負荷防止）
 *
 * 本文取得API（/api/p/*）と専用ページ（/p/*）の合算で適用される前提。統括者が
 * 同一インスタンスの `middleware` を両パスに適用することで全体制限を共有する。
 * 超過時は 429 と `Retry-After`（秒）を返し、本文・理由詳細は含めない。
 *
 * 単一プロセス前提のためインメモリでよい（ADR-0004）。
 */

export interface CreateRateLimiterOptions {
  /** クライアントIPごとの容量（=分あたり許容数）。既定値: 30 */
  perIpCapacity?: number;
  /** プロセス全体の容量（=分あたり許容数）。既定値: 300 */
  globalCapacity?: number;
  /** 補充の基準となる時間窓（ms）。既定値: 60000 */
  windowMs?: number;
  /** 現在時刻（ms）。既定値: Date.now。テストで差し替える */
  now?: () => number;
  /** 接続元IPの取得関数。既定値: node-server の getConnInfo。テストで差し替える */
  getRemoteAddress?: (c: Context<AppEnv>) => string | undefined;
  /** 満杯バケットの掃除間隔（ms）。既定値: windowMs */
  sweepIntervalMs?: number;
}

export interface RateLimiter {
  middleware: MiddlewareHandler<AppEnv>;
  /** 掃除タイマーを停止する。 */
  stop(): void;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const DEFAULT_PER_IP_CAPACITY = 30;
const DEFAULT_GLOBAL_CAPACITY = 300;
const DEFAULT_WINDOW_MS = 60_000;

function refill(bucket: Bucket, now: number, ratePerMs: number, capacity: number): void {
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * ratePerMs);
    bucket.lastRefill = now;
  }
}

export function createRateLimiter(options: CreateRateLimiterOptions = {}): RateLimiter {
  const perIpCapacity = options.perIpCapacity ?? DEFAULT_PER_IP_CAPACITY;
  const globalCapacity = options.globalCapacity ?? DEFAULT_GLOBAL_CAPACITY;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? Date.now;
  const getRemoteAddress =
    options.getRemoteAddress ?? ((c: Context<AppEnv>) => getConnInfo(c).remote.address);
  const sweepIntervalMs = options.sweepIntervalMs ?? windowMs;

  const perIpRate = perIpCapacity / windowMs;
  const globalRate = globalCapacity / windowMs;

  const globalBucket: Bucket = { tokens: globalCapacity, lastRefill: now() };
  const perIpBuckets = new Map<string, Bucket>();

  // 信頼するプロキシ判定はconfig依存。configはコンテキスト経由で最初のリクエスト時に確定する。
  let checker: TrustedProxyChecker | null = null;
  let hasTrustedProxies = false;

  // 満杯（=十分な時間アクセスがない）バケットを掃除してメモリ増加を防ぐ。
  const sweepTimer = setInterval(() => {
    const t = now();
    for (const [key, bucket] of perIpBuckets) {
      refill(bucket, t, perIpRate, perIpCapacity);
      if (bucket.tokens >= perIpCapacity) {
        perIpBuckets.delete(key);
      }
    }
  }, sweepIntervalMs);
  sweepTimer.unref?.();

  const middleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (checker === null) {
      const cidrs = c.get("config").trustedProxies;
      checker = createTrustedProxyChecker(cidrs);
      hasTrustedProxies = cidrs.length > 0;
    }

    const clientIp = resolveClientIp({
      remoteAddress: getRemoteAddress(c),
      forwardedFor: c.req.header("x-forwarded-for"),
      isTrustedProxy: checker,
      hasTrustedProxies,
    });

    const t = now();
    let bucket = perIpBuckets.get(clientIp);
    if (bucket === undefined) {
      bucket = { tokens: perIpCapacity, lastRefill: t };
      perIpBuckets.set(clientIp, bucket);
    }
    refill(bucket, t, perIpRate, perIpCapacity);
    refill(globalBucket, t, globalRate, globalCapacity);

    if (bucket.tokens < 1 || globalBucket.tokens < 1) {
      let waitMs = 0;
      if (bucket.tokens < 1) {
        waitMs = Math.max(waitMs, (1 - bucket.tokens) / perIpRate);
      }
      if (globalBucket.tokens < 1) {
        waitMs = Math.max(waitMs, (1 - globalBucket.tokens) / globalRate);
      }
      const retryAfter = Math.max(1, Math.ceil(waitMs / 1000));
      c.header("Retry-After", String(retryAfter));
      // 本文・理由詳細は含めない（content-api.md 5.）。
      return c.text("Too Many Requests\n", 429);
    }

    bucket.tokens -= 1;
    globalBucket.tokens -= 1;
    await next();
  };

  return {
    middleware,
    stop(): void {
      clearInterval(sweepTimer);
    },
  };
}
