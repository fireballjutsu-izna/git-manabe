import Link from 'next/link';
import { DOCS, docIndex, findDoc } from '@/lib/docs';
import { findLevel } from '@/lib/levels';

/**
 * 記事の下に置く、次の一手。
 *
 * 読んだだけでは身に付かないので、**まず対応するレベルへ送る**。
 * 前後の記事はその後ろに小さく置く。
 */
export function DocNav({ id }: { id: string }) {
  const doc = findDoc(id);
  const level = findLevel(id);
  const i = docIndex(id);
  const prev = i > 0 ? DOCS[i - 1] : undefined;
  const next = i >= 0 && i < DOCS.length - 1 ? DOCS[i + 1] : undefined;

  if (!doc) return null;

  return (
    <nav className="mt-12 border-t border-line pt-6" aria-label="次に読むもの">
      {level && (
        <Link
          prefetch={false}
          href={`/levels/${id}`}
          className="block rounded-card border border-line-lit px-4 py-3 no-underline hover:border-cyan-neon"
        >
          <span className="text-xs text-muted">手を動かして確かめる</span>
          <span className="mt-0.5 block font-bold text-fg">レベル: {level.title} →</span>
          <span className="mt-1 block text-sm text-muted">{level.task}</span>
        </Link>
      )}

      <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm">
        {prev ? (
          <Link
            prefetch={false}
            href={`/docs/${prev.id}`}
            className="text-muted no-underline hover:text-fg"
          >
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            prefetch={false}
            href={`/docs/${next.id}`}
            className="text-muted no-underline hover:text-fg"
          >
            {next.title} →
          </Link>
        )}
      </div>

      <p className="mt-4 text-xs text-muted">
        <Link prefetch={false} href="/docs" className="text-cyan-neon underline underline-offset-2">
          記事の一覧
        </Link>
        {' ・ '}
        <Link
          prefetch={false}
          href="/sandbox"
          className="text-cyan-neon underline underline-offset-2"
        >
          自由に触る
        </Link>
      </p>
    </nav>
  );
}
