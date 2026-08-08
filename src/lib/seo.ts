import type { Metadata } from 'next';
import { SITE, siteTitle } from './site';

/**
 * ページ 1 枚ぶんのメタデータを組み立てる。
 *
 * Next のメタデータは親から継承されるが、**openGraph は丸ごと 1 つの塊**として
 * 継承される ― 子が description だけ上書きしても、og:title と og:description は
 * 親（＝トップページ）のまま残る。実際それで、どのページを共有しても
 * 「こえだ — 動かして学ぶ Git」としか出ない状態になっていた。
 *
 * 取りこぼしが出ないよう、ページ側は必ずここを通す。
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  /** ページ名。省略するとサイト名だけになる（トップ用）。 */
  title?: string;
  description: string;
  /** basePath より下のパス。先頭と末尾のスラッシュを含める（例: '/levels/'）。 */
  path: string;
}): Metadata {
  const full = siteTitle(title);
  const url = new URL(path.replace(/^\//, ''), SITE.url).toString();

  return {
    title: title ?? { default: full, template: `%s｜${SITE.name}` },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: SITE.name,
      locale: 'ja_JP',
      title: full,
      description,
      url,
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: full }],
    },
    twitter: {
      card: 'summary_large_image',
      title: full,
      description,
      images: [OG_IMAGE],
    },
  };
}

/**
 * 共有時に出る画像。
 *
 * ページごとに作り分けはしない。1 枚の絵で足りるし、
 * ビルドのたびに 14 枚の画像を焼くほどの価値は無い。
 */
export const OG_IMAGE = `${SITE.url}og.png`;
