'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Flower, Stars } from '@/components/ui/Flower';
import { SCENARIOS, totalPar } from '@/lib/scenarios';
import { useProgressStore } from '@/store/level';

/** 花屋の言葉と、Git の言葉の対応。1 箇所にまとめて置く。 */
const GLOSSARY: [string, string][] = [
  ['店頭のアレンジ', 'main'],
  ['試作の花束', 'feature ブランチ'],
  ['一輪挿す', 'commit'],
  ['束ねる', 'merge'],
  ['バケツに生けておく', 'stash'],
  ['一輪だけ摘む', 'cherry-pick'],
  ['本店', 'origin'],
];

/**
 * シナリオの一覧。
 *
 * レベルが「概念 1 つの練習」なのに対して、こちらは仕事 1 つ。
 * 順に並べるが鍵はかけない ― どこから触っても構わない。
 */
export function ScenarioList() {
  const load = useProgressStore((s) => s.load);
  const loaded = useProgressStore((s) => s.loaded);
  const scenarios = useProgressStore((s) => s.progress.scenarios);

  useEffect(() => {
    load();
  }, [load]);

  const doneCount = Object.keys(scenarios).length;
  const starCount = Object.values(scenarios).reduce((sum, r) => sum + r.stars, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-wide text-accent">
        <Flower size={24} />
        シナリオ
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        あなたは「こえだ花店」で働いています。店長や先輩から仕事が飛んでくるので、
        git で片付けてください。場面は花屋の言葉ですが、
        <strong className="text-fg">打つコマンドは実務そのまま</strong>です。
      </p>

      <div className="mt-6 flex flex-wrap gap-3 text-sm" data-testid="scenario-progress">
        <span className="rounded-card border border-line bg-elev px-3 py-1.5">
          片付けた仕事 <strong className="font-mono text-fg">{loaded ? doneCount : '–'}</strong>
          <span className="text-muted"> / {SCENARIOS.length}</span>
        </span>
        <span className="rounded-card border border-line bg-elev px-3 py-1.5">
          星 <strong className="font-mono text-fg">{loaded ? starCount : '–'}</strong>
          <span className="text-muted"> / {SCENARIOS.length * 3}</span>
        </span>
      </div>

      <ol className="mt-8 grid gap-2">
        {SCENARIOS.map((scenario, i) => {
          const record = loaded ? scenarios[scenario.id] : undefined;
          return (
            <li key={scenario.id}>
              <Link
                prefetch={false}
                href={`/scenarios/${scenario.id}`}
                data-scenario={scenario.id}
                data-done={record ? 'true' : undefined}
                className="flex gap-4 rounded-card border border-line bg-elev px-4 py-3 no-underline hover:border-line-lit"
              >
                <span className="mt-0.5 shrink-0 font-mono text-xs text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-bold text-fg">{scenario.title}</span>
                    {record && (
                      <span className="text-remote">
                        <Stars count={record.stars} size={13} />
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                    {scenario.subtitle}
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-muted">
                    {scenario.steps.length} ステップ / 最短 {totalPar(scenario)} 手
                    {record && ` ・ あなたの記録 ${record.moves} 手`}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <section className="mt-10">
        <h2 className="border-b border-line pb-2 text-sm font-bold text-accent">
          花屋の言葉と、Git の言葉
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-line bg-inset px-3 py-2 text-left font-bold text-fg">
                  店での言い方
                </th>
                <th className="border border-line bg-inset px-3 py-2 text-left font-bold text-fg">
                  Git
                </th>
              </tr>
            </thead>
            <tbody>
              {GLOSSARY.map(([shop, git]) => (
                <tr key={git}>
                  <td className="border border-line px-3 py-2">{shop}</td>
                  <td className="border border-line px-3 py-2 font-mono text-xs">{git}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          言い換えているのは状況の説明だけで、枝やファイルの名前は実務どおりの英数字です。
          どのステップにも「やること」を素の言い方で添えてあるので、
          比喩で手が止まることはありません。
        </p>
      </section>

      <p className="mt-8 text-xs leading-relaxed text-muted">
        1 つの概念だけを練習したいときは{' '}
        <Link prefetch={false} href="/levels" className="text-cyan-neon underline underline-offset-2">
          レベル
        </Link>
        、仕組みから知りたいときは{' '}
        <Link prefetch={false} href="/docs" className="text-cyan-neon underline underline-offset-2">
          記事
        </Link>
        へ。記録はこの端末の中だけに残ります。
      </p>
    </div>
  );
}
