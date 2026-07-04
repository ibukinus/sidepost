import { encodeDidSegment } from "../lib/at-uri.js";
import { CSRF_FIELD_NAME } from "../middleware/csrf.js";
import type { SpoilerListItem } from "../services/manage.js";

/**
 * 投稿管理画面（screens.md 3.5）。
 * - 自分の投稿を新しい順に一覧表示する（削除対象選択のためだけの一覧。要件6.8）。
 * - 削除ボタンは確認ダイアログ付きフォーム。クライアントJSはADR 0004により
 *   投稿画面のバイト数カウントと専用ページの本文取得のみに限定されるため、
 *   確認ダイアログはHTML Popover API（`popover`/`popovertarget`属性）のみで実装し、
 *   JavaScriptを一切使用しない。
 */

export type ManageListError = "list-failed" | "invalid-rkey" | "swap-conflict" | "pds-error";

const ERROR_MESSAGES: Record<ManageListError, string> = {
  "list-failed": "投稿一覧を取得できませんでした。時間をおいて再度お試しください。",
  "invalid-rkey": "指定された投稿が見つかりませんでした。すでに削除されている可能性があります。",
  "swap-conflict": "他の操作と競合したため削除できませんでした。もう一度お試しください。",
  "pds-error": "削除処理に失敗しました。時間をおいて再度お試しください。",
};

export interface ManageListProps {
  did: string;
  items: SpoilerListItem[];
  nextCursor?: string;
  csrfToken: string;
  error?: ManageListError;
}

export function ManageList({ did, items, nextCursor, csrfToken, error }: ManageListProps) {
  return (
    <section class="manage">
      <h1>投稿管理</h1>
      <p>
        <a href="/compose">投稿画面へ戻る</a>
      </p>
      {error ? (
        <p class="error" role="alert">
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p>投稿はまだありません。</p>
      ) : (
        <ul class="manage-list">
          {items.map((item) => (
            <li class="manage-item">
              <time class="manage-item-date" dateTime={item.createdAt}>
                {item.createdAt}
              </time>
              <p class="manage-item-excerpt">{item.excerpt}</p>
              <p class="manage-item-actions">
                <a href={`/p/${encodeDidSegment(did)}/${item.rkey}`}>専用ページ</a>{" "}
                <button type="button" popovertarget={`manage-confirm-${item.rkey}`}>
                  削除
                </button>
              </p>
              <div id={`manage-confirm-${item.rkey}`} popover="auto" class="manage-confirm">
                <p>この投稿を削除します。この操作は取り消せません。よろしいですか？</p>
                <form method="post" action="/manage/delete">
                  <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
                  <input type="hidden" name="rkey" value={item.rkey} />
                  <button
                    type="button"
                    popovertarget={`manage-confirm-${item.rkey}`}
                    popovertargetaction="hide"
                  >
                    キャンセル
                  </button>
                  <button type="submit">削除する</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
      {nextCursor ? (
        <p>
          <a href={`/manage?cursor=${encodeURIComponent(nextCursor)}`}>さらに表示</a>
        </p>
      ) : null}
    </section>
  );
}
