import type { PropsWithChildren } from "hono/jsx";
import { CSRF_FIELD_NAME } from "../middleware/csrf.js";

export interface LayoutProps {
  title?: string | undefined;
  /** 設定時のみヘッダーにログアウトフォームを描画する（ログイン中の画面）。 */
  logoutCsrfToken?: string | undefined;
}

/**
 * 全画面共通のSSRレイアウト（screens.md 5.）。
 * - 自前CSSのみ（`/assets/css/style.css`）。CSPの `style-src 'self'` に適合。
 * - フッターに `/terms`・`/privacy` へのリンクを常設する（要件6.10）。
 * - ログイン中の画面にはヘッダーにログアウトフォーム（CSRF付きPOST）を常設する（要件6.3）。
 * - ダークモードは `prefers-color-scheme` 追従のみで、手動切り替えUIは設けない。
 */
export function Layout({ title, logoutCsrfToken, children }: PropsWithChildren<LayoutProps>) {
  const pageTitle = title ? `${title} - skyseal` : "skyseal";
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{pageTitle}</title>
        <link rel="stylesheet" href="/assets/css/style.css" />
      </head>
      <body>
        <div class="page">
          {logoutCsrfToken ? (
            <header class="page-header">
              <form method="post" action="/logout" class="logout-form">
                <input type="hidden" name={CSRF_FIELD_NAME} value={logoutCsrfToken} />
                <button type="submit">ログアウト</button>
              </form>
            </header>
          ) : null}
          <main class="page-main">{children}</main>
          <footer class="page-footer">
            <a href="/terms">利用規約</a>
            <a href="/privacy">プライバシーポリシー</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
