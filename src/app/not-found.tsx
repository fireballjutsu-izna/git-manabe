import Link from 'next/link';

/**
 * 404。
 *
 * 既定のままだと英語の "This page could not be found." が出て、
 * 日本語のサイトの中でそこだけ言語が変わってしまう。
 * 行き先を 3 つ並べて、戻り道のないページにしない。
 */
export default function NotFound() {
  return (
    <div className="py-10">
      <p className="font-mono text-sm text-muted">404</p>
      <h1 className="mt-2 text-2xl font-bold text-accent">そのページはありません</h1>
      <p className="mt-3 max-w-prose leading-relaxed text-muted">
        住所が変わったか、打ち間違いかもしれません。下のどれかへどうぞ。
      </p>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        <Link prefetch={false}
          href="/levels"
          className="rounded border border-line-lit px-4 py-2 text-fg no-underline hover:border-cyan-neon"
        >
          レベル一覧
        </Link>
        <Link prefetch={false}
          href="/sandbox"
          className="rounded border border-line px-4 py-2 text-muted no-underline hover:border-line-lit hover:text-fg"
        >
          サンドボックス
        </Link>
        <Link prefetch={false}
          href="/start"
          className="rounded border border-line px-4 py-2 text-muted no-underline hover:border-line-lit hover:text-fg"
        >
          はじめに
        </Link>
      </div>
    </div>
  );
}
