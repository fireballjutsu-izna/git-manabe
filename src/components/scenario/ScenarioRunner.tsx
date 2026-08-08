'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AreaPanes } from '@/components/graph/AreaPanes';
import { CommitGraph } from '@/components/graph/CommitGraph';
import { TodoPane } from '@/components/graph/TodoPane';
import { StepChat } from '@/components/scenario/StepChat';
import { CommandButtons } from '@/components/terminal/CommandButtons';
import { Terminal } from '@/components/terminal/Terminal';
import { Flower, Stars } from '@/components/ui/Flower';
import { findDoc } from '@/lib/docs';
import { playCommands } from '@/lib/levels';
import {
  findScenario,
  SCENARIOS,
  scenarioIndex,
  starsFor,
  totalPar,
  type Scenario,
} from '@/lib/scenarios';
import { useProgressStore } from '@/store/level';
import { useRepoStore } from '@/store/repo';

/**
 * シナリオ 1 本を遊ぶ画面。
 *
 * 部品はレベルとまったく同じ（グラフ・3 領域・ターミナル）。
 * 違うのは、目的地が 1 つではなく**順に届く**ことと、手数で星が付くこと。
 *
 * 受け取るのは id だけ。ステップは check という関数を持つので、
 * サーバーコンポーネントから丸ごとは渡せない。
 */
export function ScenarioRunner({ scenarioId }: { scenarioId: string }) {
  const scenario = findScenario(scenarioId);
  if (!scenario) throw new Error(`${scenarioId} というシナリオがありません`);
  return <Runner scenario={scenario} />;
}

function Runner({ scenario }: { scenario: Scenario }) {
  const state = useRepoStore((s) => s.history.present);
  const lastResult = useRepoStore((s) => s.lastResult);
  const pulse = useRepoStore((s) => s.pulse);
  const moves = useRepoStore((s) => s.moves);
  const loadState = useRepoStore((s) => s.loadState);

  const clearScenario = useProgressStore((s) => s.clearScenario);
  const record = useProgressStore((s) => s.progress.scenarios[scenario.id]);
  const loadProgress = useProgressStore((s) => s.load);

  /** 満たし終えたステップの数。 */
  const [done, setDone] = useState(0);
  const [openHints, setOpenHints] = useState(0);
  /** 終えたことを、この回で一度でも記録したか。 */
  const recorded = useRef(false);

  const restart = (): void => {
    setDone(0);
    setOpenHints(0);
    recorded.current = false;
    loadState(playCommands(scenario.setup), `「${scenario.title}」を始めます。`);
  };

  // シナリオを開いたら、その開始状態から始める
  useEffect(() => {
    loadProgress();
    setDone(0);
    setOpenHints(0);
    recorded.current = false;
    loadState(playCommands(scenario.setup), `「${scenario.title}」を始めます。`);
  }, [scenario, loadState, loadProgress]);

  const finished = done >= scenario.steps.length;
  const step = finished ? undefined : scenario.steps[done];

  // いまのステップが満たされたら、1 つ進める
  useEffect(() => {
    if (!step) return;
    if (!step.check(state)) return;
    setDone(done + 1);
    setOpenHints(0);
  }, [state, step, done]);

  const par = totalPar(scenario);
  const stars = starsFor(moves, par);

  useEffect(() => {
    if (finished && !recorded.current) {
      recorded.current = true;
      clearScenario(scenario.id, stars, moves);
    }
  }, [finished, clearScenario, scenario.id, stars, moves]);

  const index = scenarioIndex(scenario.id);
  const next = SCENARIOS[index + 1];

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-xs text-muted">
          シナリオ {index + 1} / {SCENARIOS.length}
          {record && (
            <span className="ml-2 text-remote">
              クリア済み <Stars count={record.stars} size={12} />
            </span>
          )}
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-bold text-accent">
          <Flower size={20} bloom={finished} />
          {scenario.title}
        </h1>
        <p className="mt-1 text-sm text-muted">{scenario.subtitle}</p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed">{scenario.intro}</p>

        {scenario.uses.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            使う考え方:{' '}
            {scenario.uses.map((id, i) => {
              const doc = findDoc(id);
              if (!doc) return null;
              return (
                <span key={id}>
                  {i > 0 && ' / '}
                  <Link
                    prefetch={false}
                    href={`/docs/${id}`}
                    className="text-cyan-neon underline underline-offset-2"
                  >
                    {doc.title}
                  </Link>
                </span>
              );
            })}
          </p>
        )}
      </header>

      {finished ? (
        <div
          data-testid="finished"
          className="rounded-card border border-remote bg-tint-lime px-4 py-3 text-sm"
        >
          <p className="flex items-center gap-2 font-bold text-remote">
            <Flower size={18} bloom />
            仕事が片付きました。
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            <span>
              <Stars count={stars} /> <span className="ml-1">星 {stars} つ</span>
            </span>
            <span className="font-mono text-xs">
              {moves} 手（最短 {par} 手）
            </span>
          </p>
          {stars < 3 && (
            <p className="mt-1 text-xs text-muted">
              最短の {par} 手で終えると星が 3 つになります。やり直せます。
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {next && (
              <Link
                prefetch={false}
                href={`/scenarios/${next.id}`}
                className="rounded border border-line-lit px-3 py-1.5 text-fg no-underline hover:border-cyan-neon"
              >
                次へ: {next.title} →
              </Link>
            )}
            <button
              type="button"
              onClick={restart}
              className="rounded border border-line px-3 py-1.5 text-muted hover:border-cyan-neon hover:text-fg"
            >
              最短を狙ってやり直す
            </button>
            <Link
              prefetch={false}
              href="/scenarios"
              className="rounded border border-line px-3 py-1.5 text-muted no-underline hover:text-fg"
            >
              シナリオ一覧
            </Link>
          </div>
        </div>
      ) : (
        <StepChat steps={scenario.steps} current={done} />
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_286px]">
        <div className="grid min-w-0 gap-4">
          {/* シナリオだけ花で描く。レベルとサンドボックスは実物どおりのまま */}
          {/* 計画を立てている最中は、グラフより先に目に入る場所へ出す */}
          <TodoPane />

          <CommitGraph state={state} theme="florist" />

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={restart}
              className="rounded border border-line px-2.5 py-1.5 text-muted hover:border-rose-neon hover:text-fg"
            >
              最初から
            </button>
            {step && openHints < step.hints.length && (
              <button
                type="button"
                onClick={() => setOpenHints((n) => n + 1)}
                className="rounded border border-line px-2.5 py-1.5 text-muted hover:border-amber-neon hover:text-fg"
              >
                ヒントを見る（{openHints} / {step.hints.length}）
              </button>
            )}
            <span className="ml-auto font-mono text-muted" data-testid="moves">
              {moves} 手 / 最短 {par}
            </span>
          </div>

          {step && openHints > 0 && (
            <ol className="grid gap-1.5 rounded-card border border-line bg-elev px-4 py-3 text-sm">
              {step.hints.slice(0, openHints).map((hint) => (
                <li key={hint} className="flex gap-2">
                  <span className="text-head">·</span>
                  <span>{hint}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="min-w-0">
            <h2 className="mb-2 text-xs font-bold tracking-wide text-accent">打てるコマンド</h2>
            <CommandButtons suggest={step?.suggest} />
          </div>

          <div className="min-w-0">
            <h2 className="mb-2 text-xs font-bold tracking-wide text-accent">ターミナル</h2>
            <Terminal />
          </div>
        </div>

        <aside className="min-w-0">
          <h2 className="mb-2 text-xs font-bold tracking-wide text-accent">3 つの領域</h2>
          <AreaPanes
            state={state}
            touched={lastResult?.touched ?? []}
            pulse={pulse}
            theme="florist"
          />
        </aside>
      </div>
    </div>
  );
}
