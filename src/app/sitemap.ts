import type { MetadataRoute } from 'next';
import { DOCS } from '@/lib/docs';
import { LEVELS } from '@/lib/levels';
import { SITE } from '@/lib/site';

/**
 * サイトマップ。
 *
 * output: 'export' でもビルド時に sitemap.xml として書き出される。
 * ページ数は多くないが、レベルが 13 枚あって一覧からしか辿れないので、
 * 置いておくと取りこぼしが減る。
 */
export const dynamic = 'force-static';

const at = (path: string) => new URL(path.replace(/^\//, ''), SITE.url).toString();

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: at('/'), priority: 1 },
    { url: at('/start/'), priority: 0.8 },
    { url: at('/docs/'), priority: 0.8 },
    { url: at('/levels/'), priority: 0.8 },
    { url: at('/sandbox/'), priority: 0.8 },
    ...DOCS.map((doc) => ({ url: at(`/docs/${doc.id}/`), priority: 0.7 })),
    ...LEVELS.map((level) => ({ url: at(`/levels/${level.id}/`), priority: 0.6 })),
  ];
}
