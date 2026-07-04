import type { LoginErrorReason } from "../services/oauth.js";

/**
 * ログイン画面（screens.md 3.1）。
 * - サービスの説明（本文は専用ページで公開、Blueskyには固定文言のみ投稿）。
 * - ハンドル入力欄と「Blueskyでログイン」ボタン。
 * - エラー表示領域（ハンドル解決失敗・granular scope非対応PDS・認可拒否）。
 */

export type LoginDisplayError = LoginErrorReason | "empty-handle";

const ERROR_MESSAGES: Record<LoginDisplayError, string> = {
  "empty-handle": "ハンドルを入力してください。",
  "handle-resolution":
    "ハンドルからアカウントを解決できませんでした。ハンドル（例: example.bsky.social）を確認してください。",
  "granular-scope-unsupported":
    "お使いのPDSはコレクション単位の権限指定（granular scope）に対応していないため、skysealにログインできません。",
  denied: "ログインがキャンセルされました。もう一度お試しください。",
  unknown: "ログインに失敗しました。時間をおいて再度お試しください。",
};

export interface LoginProps {
  error?: LoginDisplayError;
  handle?: string;
}

export function Login({ error, handle }: LoginProps) {
  return (
    <section class="login">
      <h1>skyseal</h1>
      <p>
        ネタバレを含む本文を、通常のBluesky投稿から切り離して投稿できるサービスです。
        本文は専用ページでのみ公開され、Blueskyの通常投稿には固定の案内文言と専用URLだけが表示されます。
      </p>
      <p>Blueskyアカウントでログインしてください。</p>
      {error ? (
        <p class="error" role="alert">
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}
      <form method="post" action="/oauth/login" class="login-form">
        <label for="handle">Blueskyハンドル</label>
        <input
          id="handle"
          name="handle"
          type="text"
          inputmode="url"
          autocapitalize="none"
          autocomplete="username"
          autocorrect="off"
          spellcheck={false}
          placeholder="example.bsky.social"
          value={handle ?? ""}
          required
        />
        <button type="submit">Blueskyでログイン</button>
      </form>
    </section>
  );
}
