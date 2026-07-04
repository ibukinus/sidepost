import type { PropsWithChildren } from "hono/jsx";

/**
 * 投稿表示画面（専用ページ `GET /p/{did}/{rkey}`）のSSRビュー（screens.md 3.4）。
 *
 * - 初期HTMLには本文・投稿者情報を含めない（要件6.7、architecture.md 3.2）。固定の
 *   ページタイトル・OGP・読み込み中表示・案内投稿リンクのプレースホルダのみを返す。
 * - 本文はページ読み込み後にクライアントJS（src/client/post.ts）が
 *   `GET /api/p/{did}/{rkey}` を呼んで描画する。
 *
 * 共通レイアウト（src/views/layout.tsx）はOGPメタタグの差し込みに対応していないため、
 * このページ専用に独立したHTML文書を組み立てる（layout.tsxは他フェーズと共有する
 * 基盤ファイルであり、並行作業中の変更を避けるため）。フッターの規約リンクなど
 * 全画面共通の要素は重複実装している。
 */

const PAGE_TITLE = "ネタバレ投稿";
const OGP_DESCRIPTION = "ネタバレを含む投稿です。";

function PostPageShell({ children }: PropsWithChildren) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* 検索エンジン・プレビューへの露出低減（architecture.md 5.、要件6.7）。
            HTTPヘッダのX-Robots-Tagに加え、metaタグでも明示する。 */}
        <meta name="robots" content="noindex, nosnippet, noarchive" />
        {/* ページタイトル・OGPは固定文言のみで、本文・投稿者情報に依存しない（要件6.7・7.1）。 */}
        <title>{PAGE_TITLE}</title>
        <meta property="og:title" content={PAGE_TITLE} />
        <meta property="og:description" content={OGP_DESCRIPTION} />
        <meta property="og:type" content="website" />
        {/* OGP画像は設定しない（要件6.7）。 */}
        <link rel="stylesheet" href="/assets/css/style.css" />
        <link rel="stylesheet" href="/assets/css/post-page.css" />
      </head>
      <body>
        <div class="page">
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

export interface PostPageProps {
  did: string;
  rkey: string;
}

/**
 * 表示可能な場合の初期HTML。本文・投稿者情報は含めず、クライアントJSが埋める
 * プレースホルダのみを配置する（screens.md 3.4）。
 */
export function PostPage({ did, rkey }: PostPageProps) {
  return (
    <PostPageShell>
      <section class="post-page" data-post-did={did} data-post-rkey={rkey}>
        <p class="post-status" data-role="status" role="status">
          読み込み中です…
        </p>
        <article class="post-body" data-role="body" hidden>
          <p class="spoiler-text" data-role="text" />
          <dl class="post-meta">
            <div class="post-meta-row">
              <dt>投稿者</dt>
              <dd data-role="author" />
            </div>
            <div class="post-meta-row">
              <dt>投稿日時</dt>
              <dd>
                <time data-role="created-at" />
              </dd>
            </div>
          </dl>
          <p class="post-announcement-link">
            {/* hrefはプレースホルダ。クライアントJSがannouncementUrl取得後に実際の値へ
                書き換えてから表示する（常にhidden解除と同時に設定するため、この
                プレースホルダ値がそのまま利用者に見えることはない）。 */}
            <a data-role="announcement-link" href="https://bsky.app/" hidden>
              Blueskyの案内投稿を見る
            </a>
          </p>
        </article>
      </section>
      <script type="module" src="/assets/js/post.js" />
    </PostPageShell>
  );
}

/**
 * 表示できない場合の固定メッセージページ（要件6.6、screens.md 3.4）。
 * 構文不正・表示停止・不存在などの理由は区別しない。
 */
export function PostUnavailablePage() {
  return (
    <PostPageShell>
      <p class="post-status" role="status">
        この投稿は表示できません。
      </p>
    </PostPageShell>
  );
}
