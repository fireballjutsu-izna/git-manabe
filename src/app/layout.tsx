import type { Metadata } from 'next';
import Link from 'next/link';
import { pageMetadata } from '@/lib/seo';
import { SITE } from '@/lib/site';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import './globals.css';

export const metadata: Metadata = {
  // 相対で書いた canonical や og:image を、この URL の下で解決させる
  metadataBase: new URL(SITE.url),
  ...pageMetadata({ description: SITE.description, path: '/' }),
};

/**
 * 描画前にテーマを確定させ、リロード時の白い一瞬（FOUC）を防ぐ。
 * このサイトはダークを既定の見た目とし、明示的に切り替えたときだけライトにする。
 */
const themeBootstrap = `(function(){try{var s=localStorage.getItem('git-manabe:theme');document.documentElement.dataset.theme=s==='light'?'light':'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark light" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-dvh antialiased">
        {/*
          見出しの前に、毎ページ同じリンクが 5 本並ぶ。
          キーボードや読み上げで来た人が、そこを毎回抜けずに済むようにする。
          ふだんは画面の外に置き、フォーカスが当たったときだけ出てくる。
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:border focus:border-cyan-neon focus:bg-elev focus:px-3 focus:py-2 focus:text-sm focus:text-fg focus:no-underline"
        >
          本文へスキップ
        </a>
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
          {/*
            狭い画面ではリンクが折り返して、高さ 14 の帯からはみ出す。
            改行を禁じたうえで、入りきらないぶんは横に流す。
          */}
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
            <Link prefetch={false} href="/" className="flex shrink-0 items-baseline gap-2 no-underline">
              <span className="text-lg font-bold tracking-wide text-accent">{SITE.name}</span>
              <span className="hidden text-xs text-muted sm:inline">{SITE.tagline}</span>
            </Link>
            <nav className="ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm sm:gap-1">
              {[
                { href: '/start', label: 'はじめに' },
                { href: '/docs', label: '記事' },
                { href: '/levels', label: 'レベル' },
                { href: '/scenarios', label: 'シナリオ' },
                { href: '/sandbox', label: 'サンドボックス' },
              ].map((item) => (
                <Link prefetch={false}
                  key={item.href}
                  href={item.href}
                  /* data-tap … 狭い画面で 44px 角を確保する対象（globals.css） */
                  data-tap=""
                  className="flex items-center rounded px-2 py-1.5 whitespace-nowrap text-muted no-underline hover:bg-inset hover:text-fg sm:px-2.5"
                >
                  {item.label}
                </Link>
              ))}
              <ThemeToggle />
            </nav>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>

        <footer className="mt-16 border-t border-line">
          <div className="mx-auto max-w-6xl px-4 py-8 text-xs leading-relaxed text-muted">
            <p>
              このサイトの Git は<strong className="text-fg">教育用に簡略化したモデル</strong>
              で、本物の Git を動かしているわけではありません。 正確な仕様は{' '}
              <a
                href="https://git-scm.com/doc"
                className="text-cyan-neon underline underline-offset-2"
                target="_blank"
                rel="noreferrer noopener"
              >
                git-scm 公式ドキュメント
              </a>
              を参照してください。
            </p>
            <p className="mt-2">
              <a
                href={SITE.repo}
                className="underline underline-offset-2 hover:text-fg"
                target="_blank"
                rel="noreferrer noopener"
              >
                ソースコード
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
