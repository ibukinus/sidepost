import { SafeFetchError, safeFetch } from "../lib/safe-fetch.js";

/**
 * `@atproto/oauth-client-node` に注入する fetch 実装。
 *
 * ライブラリが行う外部HTTPリクエスト（ハンドル解決のHTTP経路・認可サーバーメタデータ取得・
 * PAR・トークン発行・revocation・DPoP付きのPDSリクエスト）をすべて `safeFetch` 経由にし、
 * https限定・プライベートIP拒否・タイムアウト・サイズ上限を効かせる（oauth-session.md 3.、
 * content-api.md 6.、Phase 1引き継ぎ方針）。
 *
 * 注意（フォールバック禁止方針に沿う挙動）:
 * - `safeFetch` はリダイレクトを追従しない。認可サーバー/PDSがリダイレクトを返した場合は
 *   そのままのステータスをライブラリに渡す（SSRF対策上、追従を実装しない）。
 * - レスポンスの自動解凍は行わないため、`accept-encoding: identity` を強制し圧縮を避ける。
 */

const DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
]);

const DROP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

export type OAuthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createOAuthFetch(): OAuthFetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "POST" && method !== "HEAD") {
      throw new SafeFetchError("network-error", `未対応のHTTPメソッドです: ${method}`);
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (!DROP_REQUEST_HEADERS.has(name.toLowerCase())) {
        headers[name] = value;
      }
    });
    headers["accept-encoding"] = "identity";

    let body: Uint8Array | undefined;
    if (method === "POST") {
      const buffer = await request.arrayBuffer();
      if (buffer.byteLength > 0) {
        body = new Uint8Array(buffer);
      }
    }

    const result = await safeFetch(request.url, {
      method,
      headers,
      ...(body ? { body } : {}),
    });

    if (result.status < 200 || result.status > 599) {
      throw new SafeFetchError("network-error", `不正なHTTPステータスです: ${result.status}`);
    }

    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(result.headers)) {
      if (value === undefined || DROP_RESPONSE_HEADERS.has(name.toLowerCase())) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          responseHeaders.append(name, item);
        }
      } else {
        responseHeaders.append(name, value);
      }
    }

    // 204/205/304 と 1xx はボディを持てない（Response コンストラクタが拒否する）。
    const nullBody = result.status === 204 || result.status === 205 || result.status === 304;
    return new Response(nullBody ? null : result.body, {
      status: result.status,
      headers: responseHeaders,
    });
  };
}
