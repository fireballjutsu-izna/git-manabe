'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AreaPanes } from '@/components/graph/AreaPanes';
import { CommitGraph } from '@/components/graph/CommitGraph';
import { TodoPane } from '@/components/graph/TodoPane';
import { CommandButtons } from '@/components/terminal/CommandButtons';
import { Terminal } from '@/components/terminal/Terminal';
import { findDoc } from '@/lib/docs';
import { checkLevel, findLevel, LEVELS, levelIndex, setupState } from '@/lib/levels';
import { useProgressStore } from '@/store/level';
import { useRepoStore } from '@/store/repo';

/**
 * レベル 1 つを遊ぶ画面。
 *
 * サンドボックスとの違いは 3 つだけ:
 *   開始状態が用意されている / 目的地がある / 合格すると記録が残る
 * 中身のグラフ・ターミナル・3 領域パネルは、まったく同じ部品を使う。
 *
 * 受け取るのは id だけ。Level は check という関数を持つので、
 * サーバーコンポーネントから丸ごとは渡せない（関数はシリアライズできない）。
 * レベルの定義はただのモジュールなので、こちら側で引き直すのが素直。
 */
export function LevelRunner({ levelId }: { levelId: string }) {
  const level = findLevel(levelId);
  if (!level) throw new Error(`${levelId} というレベルがありません`);
  return <Runner level={level} />;
}

function Runner({ level }: { level: NonNullable<ReturnType<typeof findLevel>> }) {
  const state = useRepoStore((s) => s.history.present);
  const lastResult = useRepoStore((s) => s.lastResult);
  const pulse = useRepoStore((s) => s.pulse);
  const loadState = useRepoStore((s) => s.loadState);
  const undoStep = useRepoStore((s) => s.undoStep);
  const canUndo = useRepoStore((s) => s.history.past.length > 0);

  const clear = useProgressStore((s) => s.clear);
  const cleared = useProgressStore((s) => s.progress.cleared[level.id] !== undefined);
  const loadProgress = useProgressStore((s) => s.load);

  const [openHints, setOpenHints] = useState(0);
  /** 合格したことを、このレベルで一度でも記録したか。 */
  const recorded = useRef(false);

  // レベルを開いたら、その開始状態から始める
  useEffect(() => {
    loadProgress();
    recorded.current = false;
    setOpenHints(0);
    loadState(setupState(level), `「${level.title}」を始めます。`);
  }, [level, loadState, loadProgress]);

  const outcome = checkLevel(level, state);

  useEffect(() => {
    if (outcome.passed && !recorded.current) {
      recorded.current = true;
      clear(level.id);
    }
  }, [outcome.passed, clear, level.id]);

  const index = levelIndex(level.id);
  const next = LEVELS[index + 1];

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-xs text-muted">
          レベル {index + 1} / {LEVELS.length}
          {cleared && !outcome.passed && <span className="ml-2 text-remote">クリア済み</span>}
        </p>
        <h1 className="mt-1 text-xl font-bold text-accent">{level.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed">{level.intro}</p>
        {/* 詰まったときの逃げ道。ヒントより先に、仕組みのほうを見たい人もいる */}
        {findDoc(level.id) && (
          <p className="mt-2 text-xs text-muted">
            仕組みから知りたいときは{' '}
            <Link
              prefetch={false}
              href={`/docs/${level.id}`}
              className="text-cyan-neon underline underline-offset-2"
            >
              記事「{findDoc(level.id)!.title}」
            </Link>
            へ。
          </p>
        )}
      </header>

      <div
        data-testid="task"
        className="rounded-card border border-line-lit bg-inset px-4 py-3 text-sm"
      >
        <span className="font-bold text-fg">やること: </span>
        {level.task}
      </div>

      {outcome.passed && (
        <div
          data-testid="cleared"
          className="rounded-card border border-remote bg-tint-lime px-4 py-3 text-sm"
        >
          <p className="font-bold text-remote">クリアしました。</p>
          <p className="mt-1 text-muted">記録に残しました。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {next && (
              <Link prefetch={false}
                href={`/levels/${next.id}`}
                className="rounded border border-line-lit px-3 py-1.5 text-fg no-underline hover:border-cyan-neon"
              >
                次へ: {next.title} →
              </Link>
            )}
            <Link prefetch={false}
              href="/levels"
              className="rounded border border-line px-3 py-1.5 text-muted no-underline hover:text-fg"
            >
              レベル一覧
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_286px]">
        <div className="grid min-w-0 gap-4">
          {/* 計画を立てている最中は、グラフより先に目に入る場所へ出す */}
          <TodoPane />

          <CommitGraph state={state} />

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => loadState(setupState(level), 'このレベルを最初からやり直します。')}
              className="rounded border border-line px-2.5 py-1.5 text-muted hover:border-rose-neon hover:text-fg"
            >
              このレベルを最初から
            </button>
            <button
              type="button"
              onClick={undoStep}
              disabled={!canUndo}
              className="rounded border border-line px-2.5 py-1.5 text-muted enabled:hover:text-fg disabled:opacity-40"
            >
              ← 1 手戻す
            </button>
            {openHints < level.hints.length && (
              <button
                type="button"
                onClick={() => setOpenHints((n) => n + 1)}
                className="rounded border border-line px-2.5 py-1.5 text-muted hover:border-amber-neon hover:text-fg"
              >
                ヒントを見る（{openHints} / {level.hints.length}）
              </button>
            )}
          </div>

          {openHints > 0 && (
            <ol className="grid gap-1.5 rounded-card border border-line bg-elev px-4 py-3 text-sm">
              {level.hints.slice(0, openHints).map((hint) => (
                <li key={hint} className="flex gap-2">
                  <span className="text-head">·</span>
                  <span>{hint}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="min-w-0">
            <h2 className="mb-2 text-xs font-bold tracking-wide text-accent">打てるコマンド</h2>
            <CommandButtons suggest={level.suggest} />
          </div>

          {/*
            min-w-0 が無いと、グリッドの子は min-width:auto のまま ―
            xterm の最小幅にひきずられて、狭い画面で本文ごと横にはみ出す。
          */}
          <div className="min-w-0">
            <h2 className="mb-2 text-xs font-bold tracking-wide text-accent">ターミナル</h2>
            <Terminal />
          </div>
        </div>

        <aside className="min-w-0">
          <h2 className="mb-2 text-xs font-bold tracking-wide text-accent">3 つの領域</h2>
          <AreaPanes state={state} touched={lastResult?.touched ?? []} pulse={pulse} />
        </aside>
      </div>
    </div>
  );
}
