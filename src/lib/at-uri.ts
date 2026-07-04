/**
 * DID・rkeyを含むURL構築（content-api.md 1.、lexicon.md 1.〜2.）。
 * 専用ページURLは案内投稿の作成（spoiler-post）と削除時の検証（manage）の双方が
 * 参照するため、必ずここで一元的に構築する（乖離すると削除対象の判定が壊れる）。
 */

/**
 * DIDをURLパスセグメントとしてエンコードする。
 * `did:web` はポート等を `%3A` のようにパーセントエンコードして含み得るため、
 * `%` を `%25` へエスケープしないとサーバー側のパスデコードで別のDID文字列に化け、
 * 構文検証（parseDid）に通らないURLが生成されてしまう。
 * それ以外のDID構成文字（英数・`:`・`.`・`-`）はパスセグメントとしてそのまま合法。
 */
export function encodeDidSegment(did: string): string {
  return did.replaceAll("%", "%25");
}

/** 専用ページURLを構築する（ドメインをハードコードせず origin から導出。要件3.2）。 */
export function buildDedicatedUrl(origin: string, did: string, rkey: string): string {
  return `${origin}/p/${encodeDidSegment(did)}/${rkey}`;
}

/**
 * 本文レコードの `announcementRkey` から、Bluesky上の案内投稿URLを導出する。
 * 案内投稿の生存確認はしない（content-api.md 1.、要件6.6）。
 *
 * @param did 投稿者のDID
 * @param announcementRkey 案内投稿（app.bsky.feed.post）のレコードキー
 */
export function buildAnnouncementUrl(did: string, announcementRkey: string): string {
  return `https://bsky.app/profile/${encodeDidSegment(did)}/post/${announcementRkey}`;
}
