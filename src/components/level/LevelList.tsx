'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { LEVELS } from '@/lib/levels';
import { useProgressStore } from '@/store/level';

/**
 * レベルの一覧と、学習の記録。
 *
 * 順番に並べるが、鍵はかけない。
 * 知りたいところから読める人を、前から順に足止めする理由がないため。
 */
export function LevelList() {
  const load = useProgressStore((s) => s.load);
  const loaded = useProgressStore((s) => s.loaded);
  const progress = useProgressStore((s) => s.progress);
  const reset = useProgressStore((s) => s.reset);

  useEffect(() => {
    load();
  }, [load]);

  const clearedCount = Object.keys(progress.cleared).length;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-wide text-accent">レベル</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        1 つのレベルで扱う概念は 1 つだけです。状況はこちらで用意してあるので、
        その概念そのものを打つところに集中できます。
      </p>

      {/* 記録は読み込み終わるまで出さない。0 と出してから書き換わると、消えたように見える */}
      <div className="mt-6 flex flex-wrap gap-3 text-sm" data-testid="progress">
        <span className="rounded-card border border-line bg-elev px-3 py-1.5">
          クリア{' '}
          <strong className="font-mono text-fg">{loaded ? clearedCount : '–'}</strong>
          <span className="text-muted"> / {LEVELS.length}</span>
        </span>
        <span className="rounded-card border border-line bg-elev px-3 py-1.5">
          連続 <strong className="font-mono text-fg">{loaded ? progress.streak : '–'}</strong>
          <span className="text-muted"> 日</span>
        </span>
        {loaded && clearedCount > 0 && (
          <button
            type="button"
            onClick={reset}
            className="rounded-card border border-line px-3 py-1.5 text-xs text-muted hover:border-rose-neon hover:text-fg"
          >
            記録を消す
          </button>
        )}
      </div>

      <ol className="mt-8 grid gap-2">
        {LEVELS.map((level, i) => {
          const done = loaded && progress.cleared[level.id] !== undefined;
          return (
            <li key={level.id}>
              <Link prefetch={false}
                href={`/levels/${level.id}`}
                data-level={level.id}
                data-cleared={done ? 'true' : undefined}
                className="flex items-start gap-3 rounded-card border border-line bg-elev px-4 py-3 no-underline hover:border-line-lit"
              >
                <span
                  className="mt-0.5 w-6 shrink-0 text-center font-mono text-xs"
                  style={{ color: done ? 'var(--remote)' : 'var(--text-muted)' }}
                  aria-hidden
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold text-fg">{level.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                    {level.task}
                  </span>
                  {done && (
                    <span className="mt-1 block text-[11px] text-remote">
                      {progress.cleared[level.id]} にクリア
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <p className="mt-8 text-xs leading-relaxed text-muted">
        記録はこの端末の中だけに保存されます（localStorage）。アカウントはありません。
        自由に触りたいときは{' '}
        <Link prefetch={false} href="/sandbox" className="text-cyan-neon underline underline-offset-2">
          サンドボックス
        </Link>
        へどうぞ。
      </p>
    </div>
  );
}
