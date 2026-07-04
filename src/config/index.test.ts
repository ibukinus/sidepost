import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, type EnvSource, loadConfig } from "./index.js";

const VALID_JWK = {
  kty: "EC",
  crv: "P-256",
  kid: "key-1",
  d: "d-component",
  x: "x-component",
  y: "y-component",
};

describe("loadConfig", () => {
  let tmpDir: string;
  let denylistPath: string;
  let dbPath: string;
  let baseEnv: EnvSource;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skyseal-config-test-"));
    denylistPath = path.join(tmpDir, "denylist.json");
    fs.writeFileSync(denylistPath, JSON.stringify({ dids: [], records: [] }));
    dbPath = path.join(tmpDir, "skyseal.db");

    baseEnv = {
      SKYSEAL_ORIGIN: "https://skyseal.example.com",
      SKYSEAL_DB_PATH: dbPath,
      SKYSEAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      SKYSEAL_OAUTH_PRIVATE_KEYS: JSON.stringify([VALID_JWK]),
      SKYSEAL_DENYLIST_PATH: denylistPath,
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("すべて有効な場合は設定を返す", () => {
    const config = loadConfig(baseEnv);
    expect(config.origin).toBe("https://skyseal.example.com");
    expect(config.dbPath).toBe(dbPath);
    expect(config.encryptionKey).toHaveLength(32);
    expect(config.oauthPrivateKeys).toEqual([VALID_JWK]);
    expect(config.trustedProxies).toEqual([]);
    expect(config.denylistPath).toBe(denylistPath);
  });

  it("SKYSEAL_TRUSTED_PROXIESが未設定なら空配列になる", () => {
    const config = loadConfig(baseEnv);
    expect(config.trustedProxies).toEqual([]);
  });

  it("SKYSEAL_TRUSTED_PROXIESの妥当なCIDRを配列として受理する", () => {
    const config = loadConfig({
      ...baseEnv,
      SKYSEAL_TRUSTED_PROXIES: "203.0.113.0/24, 2001:db8::/32",
    });
    expect(config.trustedProxies).toEqual(["203.0.113.0/24", "2001:db8::/32"]);
  });

  it("SKYSEAL_TRUSTED_PROXIESの不正なCIDRを拒否する", () => {
    expect(() => loadConfig({ ...baseEnv, SKYSEAL_TRUSTED_PROXIES: "not-a-cidr" })).toThrow(
      ConfigError,
    );
  });

  it.each([
    "SKYSEAL_ORIGIN",
    "SKYSEAL_DB_PATH",
    "SKYSEAL_ENCRYPTION_KEY",
    "SKYSEAL_OAUTH_PRIVATE_KEYS",
    "SKYSEAL_DENYLIST_PATH",
  ])("%s が欠けている場合はConfigErrorを投げる", (key) => {
    const env = { ...baseEnv };
    delete (env as Record<string, string | undefined>)[key];
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it("SKYSEAL_ORIGINにパスが含まれる場合は拒否する", () => {
    expect(() =>
      loadConfig({ ...baseEnv, SKYSEAL_ORIGIN: "https://skyseal.example.com/path" }),
    ).toThrow(ConfigError);
  });

  it("SKYSEAL_ORIGINが不正なURLの場合は拒否する", () => {
    expect(() => loadConfig({ ...baseEnv, SKYSEAL_ORIGIN: "not a url" })).toThrow(ConfigError);
  });

  it("SKYSEAL_DB_PATHの親ディレクトリが存在しない場合は拒否する", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        SKYSEAL_DB_PATH: path.join(tmpDir, "no-such-dir", "skyseal.db"),
      }),
    ).toThrow(ConfigError);
  });

  it("SKYSEAL_ENCRYPTION_KEYがbase64でない場合は拒否する", () => {
    expect(() => loadConfig({ ...baseEnv, SKYSEAL_ENCRYPTION_KEY: "not base64!!" })).toThrow(
      ConfigError,
    );
  });

  it("SKYSEAL_ENCRYPTION_KEYが32バイトでない場合は拒否する", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        SKYSEAL_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64"),
      }),
    ).toThrow(ConfigError);
  });

  it("SKYSEAL_OAUTH_PRIVATE_KEYSが不正なJSONの場合は拒否する", () => {
    expect(() => loadConfig({ ...baseEnv, SKYSEAL_OAUTH_PRIVATE_KEYS: "{not json" })).toThrow(
      ConfigError,
    );
  });

  it("SKYSEAL_OAUTH_PRIVATE_KEYSが空配列の場合は拒否する", () => {
    expect(() => loadConfig({ ...baseEnv, SKYSEAL_OAUTH_PRIVATE_KEYS: "[]" })).toThrow(ConfigError);
  });

  it("SKYSEAL_OAUTH_PRIVATE_KEYSにEC P-256以外が含まれる場合は拒否する", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        SKYSEAL_OAUTH_PRIVATE_KEYS: JSON.stringify([{ ...VALID_JWK, kty: "RSA" }]),
      }),
    ).toThrow(ConfigError);
  });

  it("SKYSEAL_OAUTH_PRIVATE_KEYSに必須フィールド欠落がある場合は拒否する", () => {
    const { kid: _kid, ...missingKid } = VALID_JWK;
    expect(() =>
      loadConfig({
        ...baseEnv,
        SKYSEAL_OAUTH_PRIVATE_KEYS: JSON.stringify([missingKid]),
      }),
    ).toThrow(ConfigError);
  });

  it("SKYSEAL_OAUTH_PRIVATE_KEYSにkidの重複がある場合は拒否する", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        SKYSEAL_OAUTH_PRIVATE_KEYS: JSON.stringify([VALID_JWK, VALID_JWK]),
      }),
    ).toThrow(ConfigError);
  });

  it("SKYSEAL_DENYLIST_PATHが存在しないファイルの場合は拒否する", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        SKYSEAL_DENYLIST_PATH: path.join(tmpDir, "no-such-file.json"),
      }),
    ).toThrow(ConfigError);
  });
});
