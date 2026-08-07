'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

const KEY = 'git-manabe:theme';

/**
 * テーマの切り替え。既定はダークで、明示的に切り替えたときだけライトになる。
 * 初期値は layout.tsx のインラインスクリプトが描画前に確定させているので、
 * ここでは「今 html に付いている値」を読むだけにする（点滅を起こさない）。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* 保存できなくても表示は切り替わる */
    }
    setTheme(next);
  };

  // サーバ側では現在のテーマが分からないので、決まるまでは中身を出さない。
  // 幅だけ確保しておき、ヘッダーが後からずれないようにする。
  if (theme === null) return <span className="inline-block h-8 w-8" aria-hidden />;

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded px-2.5 py-1.5 text-muted hover:bg-inset hover:text-fg"
      aria-label={theme === 'dark' ? 'ライトテーマに切り替える' : 'ダークテーマに切り替える'}
      title={theme === 'dark' ? 'ライトテーマに切り替える' : 'ダークテーマに切り替える'}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
