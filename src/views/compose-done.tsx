/**
 * 投稿完了画面（screens.md 3.3）。
 *
 * - 専用ページURL（コピー用）とBluesky案内投稿へのリンクを表示する。
 * - 「続けて投稿する」「投稿を管理する」への導線を設ける。
 */

export interface ComposeDoneProps {
  dedicatedUrl: string;
  announcementUrl: string;
}

export function ComposeDone({ dedicatedUrl, announcementUrl }: ComposeDoneProps) {
  return (
    <section class="compose-done">
      <h1>投稿しました</h1>
      <p>
        ネタバレ本文は専用ページで公開されています。Blueskyには固定の案内文言と専用URLのみが投稿されました。
      </p>

      <div class="compose-done-field">
        <label for="compose-done-url">専用ページURL</label>
        <input id="compose-done-url" type="text" readonly={true} value={dedicatedUrl} />
      </div>

      <p>
        <a href={announcementUrl} target="_blank" rel="noopener noreferrer">
          Blueskyの案内投稿を見る
        </a>
      </p>

      <p class="compose-done-actions">
        <a href="/compose">続けて投稿する</a>
        <a href="/manage">投稿を管理する</a>
      </p>
    </section>
  );
}
