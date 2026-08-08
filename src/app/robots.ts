import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/** 全部見せてよい。サイトマップの場所だけ伝える。 */
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: new URL('sitemap.xml', SITE.url).toString(),
  };
}
