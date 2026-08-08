import Link from 'next/link';
import { DOCS } from '@/lib/docs';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: '記事',
  description:
    '3 領域・ブランチと HEAD・merge とコンフリクト・reset の 3 モード・rebase・reflog・リモートまで、Git の仕組みを 1 項目ずつ日本語で読みます。',
  path: '/docs/',
});

/**
 * 記事の一覧。
 *
 * 並び順はレベルと同じ ― 前の記事に出たものしか使わない順に並べてある。
 * 読むだけで終わらせないよう、各記事の末尾から対応するレベルへ送る。
 */
export default function DocsIndexPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-accent">記事</h1>
      <p className="mt-2 leading-relaxed text-muted">
        1 本につき 1 つの概念です。読んだら、そのまま同じ題のレベルへ進めます。
        先に手を動かしたい人は{' '}
        <Link prefetch={false} href="/levels" className="text-cyan-neon underline underline-offset-2">
          レベル
        </Link>
        から、仕組みの前置きを読みたい人は{' '}
        <Link prefetch={false} href="/start" className="text-cyan-neon underline underline-offset-2">
          はじめに
        </Link>
        からどうぞ。
      </p>

      <ol className="mt-8 grid gap-2">
        {DOCS.map((doc, i) => (
          <li key={doc.id}>
            <Link
              prefetch={false}
              href={`/docs/${doc.id}`}
              data-doc={doc.id}
              className="flex gap-4 rounded-card border border-line bg-elev px-4 py-3 no-underline hover:border-line-lit"
            >
              <span className="mt-0.5 shrink-0 font-mono text-xs text-muted">{i + 1}</span>
              <span className="min-w-0">
                <span className="block font-bold text-fg">{doc.title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                  {doc.summary}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
