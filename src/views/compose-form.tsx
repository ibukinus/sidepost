import { APPROX_BYTES_PER_CHAR } from "../client/compose.js";
import { CSRF_FIELD_NAME } from "../middleware/csrf.js";
import type { ComposeValidationError } from "../services/spoiler-post.js";
import { SPOILER_TEXT_MAX_BYTES } from "../services/spoiler-post.js";

/**
 * 投稿画面（screens.md 3.2、要件6.2）。
 *
 * - 入力欄はネタバレ本文のテキストエリアのみ。
 * - 残り入力可能量の表示はクライアントJS（src/client/compose.ts）が担う
 *   （progressive enhancement。JS無効環境でもサーバー側検証だけで投稿は成立する）。
 * - 検証エラー時は本文を保持したまま再描画する（要件6.2）。
 */

export type ComposeDisplayError = ComposeValidationError | "write-failed";

const ERROR_MESSAGES: Record<ComposeDisplayError, string> = {
  empty: "本文を入力してください（空白のみの投稿はできません）。",
  "too-long": `本文は${SPOILER_TEXT_MAX_BYTES.toLocaleString("ja-JP")}バイト以内で入力してください。`,
  "write-failed": "投稿の作成に失敗しました。時間をおいて再度お試しください。",
};

export interface ComposeFormProps {
  csrfToken: string;
  text?: string;
  error?: ComposeDisplayError;
}

export function ComposeForm({ csrfToken, text, error }: ComposeFormProps) {
  const maxBytesLabel = SPOILER_TEXT_MAX_BYTES.toLocaleString("ja-JP");
  // 空入力時の「残り文字数」初期表示。クライアントJS（computeCounterState）と同じ換算。
  const initialCharsLabel = Math.floor(
    SPOILER_TEXT_MAX_BYTES / APPROX_BYTES_PER_CHAR,
  ).toLocaleString("ja-JP");
  return (
    <section class="compose">
      <h1>投稿</h1>
      <p>この本文は専用ページで公開されます。Blueskyの通常投稿には本文は表示されません。</p>
      {error ? (
        <p class="error" role="alert">
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}
      <form method="post" action="/compose" class="compose-form">
        <label for="compose-text">ネタバレ本文</label>
        <textarea id="compose-text" name="text" required={true} rows={12}>
          {text ?? ""}
        </textarea>
        <p
          class="compose-counter"
          id="compose-counter"
          aria-live="polite"
          data-max-bytes={SPOILER_TEXT_MAX_BYTES}
        >
          残り入力可能量（目安）: <span id="compose-counter-remaining">{maxBytesLabel}</span>{" "}
          バイト（約 <span id="compose-counter-chars">{initialCharsLabel}</span> 文字）
        </p>
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        <button type="submit" id="compose-submit">
          投稿する
        </button>
      </form>
      <script type="module" src="/assets/js/compose.js" />
    </section>
  );
}
