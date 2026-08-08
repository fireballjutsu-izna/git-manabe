import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE, siteTitle } from '@/lib/site';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import './globals.css';

export const metadata: Metadata = {
  title: { default: siteTitle(), template: `%s｜${SITE.name}` },
  description: SITE.description,
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: siteTitle(),
    description: SITE.description,
    url: SITE.url,
    locale: 'ja_JP',
  },
  twitter: { card: 'summary' },
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
        <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
            <Link href="/" className="flex items-baseline gap-2 no-underline">
              <span className="text-lg font-bold tracking-wide text-accent">{SITE.name}</span>
              <span className="hidden text-xs text-muted sm:inline">{SITE.tagline}</span>
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <Link
                href="/levels"
                className="rounded px-2.5 py-1.5 text-muted no-underline hover:bg-inset hover:text-fg"
              >
                レベル
              </Link>
              <Link
                href="/sandbox"
                className="rounded px-2.5 py-1.5 text-muted no-underline hover:bg-inset hover:text-fg"
              >
                サンドボックス
              </Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>

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
