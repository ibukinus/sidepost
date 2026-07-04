import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { openDatabase } from "./db/index.js";
import { CSRF_FIELD_NAME, generateCsrfToken } from "./middleware/csrf.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { createContentApi } from "./routes/content-api.js";
import { createDidResolver } from "./services/did.js";
import { createOAuthClient } from "./services/oauth.js";
import { createPdsReader } from "./services/pds-read.js";
import { createAppSession, SESSION_COOKIE_NAME } from "./services/session.js";

// 実在するES256 (EC P-256) の秘密鍵JWK（テスト専用に生成した固定値）。
// OAuthクライアント構築には有効な鍵が必要なため、ダミー文字列ではなく実鍵を用いる。
const TEST_PRIVATE_JWK = {
  kty: "EC",
  kid: "test-key-1",
  crv: "P-256",
  x: "ScTWSja-eW7rqPGkm3OAkbU6lT-qs83bMWFBP071G9Y",
  y: "FWtMTGtb4wXeeM-HLc4_GjBm0XAmCwbx_RPBb9ymUJE",
  d: "9-DiLAZMNybco4dIjvExiwcCfeZb3HksVs6YNPy5yS8",
};

describe("createApp", () => {
  let tmpDir: string;
  let cleanups: Array<() => void>;

  async function buildApp() {
    fs.writeFileSync(path.join(tmpDir, "denylist.json"), JSON.stringify({ dids: [], records: [] }));
    const config = loadConfig({
      SKYSEAL_ORIGIN: "https://skyseal.example.com",
      SKYSEAL_DB_PATH: path.join(tmpDir, "skyseal.db"),
      SKYSEAL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      SKYSEAL_OAUTH_PRIVATE_KEYS: JSON.stringify([TEST_PRIVATE_JWK]),
      SKYSEAL_DENYLIST_PATH: path.join(tmpDir, "denylist.json"),
    });
    const db = openDatabase(path.join(tmpDir, "skyseal.db"));
    const oauthClient = await createOAuthClient(config, db);
    const didResolver = createDidResolver();
    const contentApi = createContentApi(config, { didResolver });
    const pdsReader = createPdsReader({ didResolver });
    const rateLimiter = createRateLimiter();
    cleanups.push(() => {
      contentApi.stop();
      rateLimiter.stop();
    });
    return {
      app: createApp({ config, db, oauthClient, contentApi, rateLimiter, pdsReader }),
      db,
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skyseal-app-test-"));
    cleanups = [];
  });

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET / はログイン画面を200で返し、共通ヘッダとフッターリンクを含む", async () => {
    const { app, db } = await buildApp();
    const res = await app.request("/");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(body).toContain("Blueskyでログイン");
    expect(body).toContain('action="/oauth/login"');
    expect(body).toContain('href="/terms"');
    expect(body).toContain('href="/privacy"');
    db.close();
  });

  it("ログイン済みなら GET / は /compose へリダイレクトする", async () => {
    const { app, db } = await buildApp();
    const session = createAppSession(db, "did:plc:abc");
    const res = await app.request("/", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.sessionId}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/compose");
    db.close();
  });

  it("GET /oauth/client-metadata.json は正しいメタデータを返す", async () => {
    const { app, db } = await buildApp();
    const res = await app.request("/oauth/client-metadata.json");
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.client_id).toBe("https://skyseal.example.com/oauth/client-metadata.json");
    expect(meta.redirect_uris).toEqual(["https://skyseal.example.com/oauth/callback"]);
    expect(meta.jwks_uri).toBe("https://skyseal.example.com/oauth/jwks.json");
    expect(meta.token_endpoint_auth_method).toBe("private_key_jwt");
    expect(meta.token_endpoint_auth_signing_alg).toBe("ES256");
    expect(meta.scope).toBe(
      "atproto repo:jp.mp0.skyseal.post?action=create&action=delete repo:app.bsky.feed.post?action=create&action=delete",
    );
    db.close();
  });

  it("GET /oauth/jwks.json は公開鍵のみを返し、秘密要素dを含まない", async () => {
    const { app, db } = await buildApp();
    const res = await app.request("/oauth/jwks.json");
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(TEST_PRIVATE_JWK.d);
    const jwks = JSON.parse(raw) as { keys: Array<Record<string, unknown>> };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]?.kid).toBe("test-key-1");
    expect(jwks.keys[0]?.x).toBe(TEST_PRIVATE_JWK.x);
    expect(jwks.keys[0]?.d).toBeUndefined();
    db.close();
  });

  it("POST /oauth/login は空ハンドルでエラーを表示する", async () => {
    const { app, db } = await buildApp();
    const res = await app.request("/oauth/login", {
      method: "POST",
      body: new URLSearchParams({ handle: "  " }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ハンドルを入力してください");
    db.close();
  });

  it("POST /logout は未ログインだと / へリダイレクトする", async () => {
    const { app, db } = await buildApp();
    const res = await app.request("/logout", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    db.close();
  });

  it("ログイン中の画面にはログアウトフォームが描画され、未ログイン画面には出ない", async () => {
    const { app, db } = await buildApp();
    const session = createAppSession(db, "did:plc:abc");

    const authed = await app.request("/compose", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.sessionId}` },
    });
    expect(authed.status).toBe(200);
    const authedBody = await authed.text();
    expect(authedBody).toContain('action="/logout"');
    expect(authedBody).toContain(`name="${CSRF_FIELD_NAME}"`);

    const anonymous = await app.request("/");
    expect(await anonymous.text()).not.toContain('action="/logout"');
    db.close();
  });

  it("POST /logout は同一DIDの他のアプリセッションもすべて無効化する", async () => {
    const { app, db } = await buildApp();
    const did = "did:plc:abc";
    const sessionA = createAppSession(db, did);
    const sessionB = createAppSession(db, did);

    const res = await app.request("/logout", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionA.sessionId}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        [CSRF_FIELD_NAME]: generateCsrfToken(sessionA.csrfSecret),
      }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");

    // 別ブラウザのセッションBも失効している（認証必須ページは / へリダイレクト）。
    const other = await app.request("/compose", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionB.sessionId}` },
    });
    expect(other.status).toBe(302);
    expect(other.headers.get("location")).toBe("/");
    db.close();
  });
});
