/**
 * プライバシーポリシーページ（screens.md 3.7、terms-and-privacy.md）。
 * docs/design/terms-and-privacy.md の文面案をJSXへ変換。
 * プレースホルダは仮表示（「（準備中）」等）で表示。
 */

export function Privacy() {
  return (
    <article class="legal-article">
      <h1>プライバシーポリシー</h1>

      <section>
        <h2>1. 取得・保存する情報</h2>
        <p>本サービスは、以下の情報のみを取得・保存します。</p>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>情報</th>
                <th>内容</th>
                <th>保存期間</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>OAuthセッション情報</td>
                <td>DID、アクセストークン等（暗号化して保存）</td>
                <td>ログアウト・連携解除・失効まで</td>
              </tr>
              <tr>
                <td>セッションCookie</td>
                <td>ログイン状態の維持に必要なセッションIDのみ</td>
                <td>発行から14日</td>
              </tr>
              <tr>
                <td>稼働メトリクス</td>
                <td>匿名化・集計済みのリクエスト数等</td>
                <td>—</td>
              </tr>
              <tr>
                <td>表示停止対象の識別子</td>
                <td>表示停止したDIDおよびレコードキー</td>
                <td>表示停止の解除まで</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>2. 保存しない情報</h2>
        <ol>
          <li>
            <strong>投稿本文を本サービス側に恒久保存しません。</strong>
            本文は投稿者自身のPDSに保存され、専用ページでの表示時も本サービスはリクエスト処理中のみ本文を扱い、データベース・ログ・分析基盤に記録しません。
          </li>
          <li>アクセスログに投稿本文を含めません。</li>
          <li>広告・トラッキング目的のCookieや外部のアクセス解析サービスは使用しません。</li>
        </ol>
      </section>

      <section>
        <h2>3. 利用目的</h2>
        <p>取得した情報は、以下の目的にのみ利用します。</p>
        <ol>
          <li>ログイン状態の維持と、投稿者本人による投稿・削除の実行</li>
          <li>サービスの安定運用（レート制限、不正アクセス対策）</li>
          <li>利用規約に基づく表示停止の実施</li>
        </ol>
      </section>

      <section>
        <h2>4. 第三者提供</h2>
        <p>
          法令に基づく場合を除き、取得した情報を第三者に提供しません。なお、投稿本文およびBluesky上の案内投稿はAT
          Protocol上の公開データであり、投稿者自身のPDSの管理下にあります（本ポリシーの適用対象外です）。
        </p>
      </section>

      <section>
        <h2>5. 問い合わせ</h2>
        <p>
          本ポリシーに関する問い合わせは、skyseal公式Blueskyアカウント（<code>（準備中）</code>
          ）で受け付けます。
        </p>
      </section>

      <section>
        <p>
          <strong>制定日：（準備中）</strong>
        </p>
      </section>
    </article>
  );
}
