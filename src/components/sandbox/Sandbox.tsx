'use client';

import Link from 'next/link';
import { AreaPanes } from '@/components/graph/AreaPanes';
import { CommitGraph } from '@/components/graph/CommitGraph';
import { CommandButtons } from '@/components/terminal/CommandButtons';
import { Terminal } from '@/components/terminal/Terminal';
import { useRepoStore } from '@/store/repo';

export function Sandbox() {
  const state = useRepoStore((s) => s.history.present);
  const lastResult = useRepoStore((s) => s.lastResult);
  const pulse = useRepoStore((s) => s.pulse);
  const undoStep = useRepoStore((s) => s.undoStep);
  const redoStep = useRepoStore((s) => s.redoStep);
  const resetAll = useRepoStore((s) => s.resetAll);
  const canUndo = useRepoStore((s) => s.history.past.length > 0);
  const canRedo = useRepoStore((s) => s.history.future.length > 0);

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-accent">サンドボックス</h1>
          <p className="mt-1 text-sm text-muted">
            打ったコマンドがそのままグラフになります。何をしても壊れません。
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={undoStep}
            disabled={!canUndo}
            className="rounded border border-line px-2.5 py-1.5 text-muted enabled:hover:border-line-lit enabled:hover:text-fg disabled:opacity-40"
          >
            ← 1 手戻す
          </button>
          <button
            type="button"
            onClick={redoStep}
            disabled={!canRedo}
            className="rounded border border-line px-2.5 py-1.5 text-muted enabled:hover:border-line-lit enabled:hover:text-fg disabled:opacity-40"
          >
            やり直す →
          </button>
          <button
            type="button"
            onClick={resetAll}
            className="rounded border border-line px-2.5 py-1.5 text-muted hover:border-rose-neon hover:text-fg"
          >
            最初から
          </button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_286px]">
        <div className="grid min-w-0 gap-4">
          <CommitGraph state={state} />

          <div className="min-w-0">
            <h2 className="mb-2 text-xs font-bold tracking-wide text-accent">
              打てるコマンド（押すとそのまま実行されます）
            </h2>
            <CommandButtons />
          </div>

          {/*
            min-w-0 が無いと、グリッドの子は min-width:auto のまま ―
            xterm の最小幅にひきずられて、狭い画面で本文ごと横にはみ出す。
          */}
          <div className="min-w-0">
            <h2 className="mb-2 text-xs font-bold tracking-wide text-accent">
              ターミナル（下の欄か、画面に直接打てます・↑↓ で履歴）
            </h2>
            <Terminal />
          </div>
        </div>

        <aside className="min-w-0">
          <h2 className="mb-2 text-xs font-bold tracking-wide text-accent">
            3 つの領域（書き換わったところが光ります）
          </h2>
          <AreaPanes state={state} touched={lastResult?.touched ?? []} pulse={pulse} />

          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            <code className="font-mono">touch</code> と <code className="font-mono">edit</code>{' '}
            は Git のコマンドではありません。作業ディレクトリに変更を作るための、このサイト独自のものです。
            仕組みの説明は <Link prefetch={false} href="/start" className="text-cyan-neon underline underline-offset-2">はじめに</Link> にあります。
          </p>
        </aside>
      </div>
    </div>
  );
}
