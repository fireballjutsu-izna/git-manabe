/**
 * サイトの名前と説明を 1 箇所にまとめる。
 * 表示名はリポジトリ名（git-manabe）とは別で、ここだけ直せば全体に反映される。
 */

export const SITE = {
  /** 表示名。ヘッダー・タイトル・OGP で使う。 */
  name: 'こえだ',
  /** 名前だけでは何のサイトか分からないので、必ず添えるひとこと。 */
  tagline: '動かして学ぶ Git',
  description:
    'git コマンドを打つと、コミットの木が目の前で育ちます。作業ディレクトリ・ステージ・リポジトリの 3 領域と、ブランチ・HEAD の動きを図で見ながら Git を覚える日本語の学習サイトです。',
  /** GitHub Pages の配信先。basePath は next.config.mjs 側で固定している。 */
  url: 'https://fireballjutsu-izna.github.io/git-manabe/',
  repo: 'https://github.com/fireballjutsu-izna/git-manabe',
} as const;

/** `<title>` に使う文字列。 */
export const siteTitle = (page?: string): string =>
  page ? `${page}｜${SITE.name}` : `${SITE.name} — ${SITE.tagline}`;
