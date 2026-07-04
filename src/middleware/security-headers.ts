import type { MiddlewareHandler } from "hono";

/**
 * 全ページ共通のセキュリティヘッダ（architecture.md 5.）。
 *
 * `/p/*` と本文取得APIに追加で必要な `X-Robots-Tag` / `Cache-Control: no-store`
 * （architecture.md 5.、content-api.md 1.）は、それぞれのルートで個別に付与すること
 * （本ミドルウェアの責務外）。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Content-Type-Options", "nosniff");
  };
}
