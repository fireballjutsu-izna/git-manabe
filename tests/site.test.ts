import { describe, expect, it } from 'vitest';
import { SITE, siteTitle } from '@/lib/site';

describe('サイトの名前', () => {
  it('表示名とひとことが揃っている', () => {
    expect(SITE.name).toBe('こえだ');
    expect(SITE.tagline).not.toHaveLength(0);
  });

  it('ページ名を渡すと「ページ名｜サイト名」になる', () => {
    expect(siteTitle()).toBe('こえだ — 動かして学ぶ Git');
    expect(siteTitle('サンドボックス')).toBe('サンドボックス｜こえだ');
  });
});
