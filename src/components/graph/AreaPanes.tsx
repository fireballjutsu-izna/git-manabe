'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  aheadBehind,
  currentBranchName,
  headCommitId,
  type Area,
  type RepoState,
} from '@/lib/git-engine';

/**
 * 作業ディレクトリ / ステージ / リポジトリ の 3 領域。
 *
 * 直前のコマンドが書き換えた領域だけを一瞬光らせる。
 * 「どのコマンドがどこを触ったのか」は、説明を読むより光ったのを見るほうが早い。
 * これを出せることが、本物の Git ではなく自前のシミュレータを書いている理由でもある。
 */
export function AreaPanes({
  state,
  touched,
  pulse,
}: {
  state: RepoState;
  touched: Area[];
  pulse: number;
}) {
  const reduce = useReducedMotion();
  const [lit, setLit] = useState<Area[]>([]);

  // pulse が変わるたびに光らせ直す。
  // touched の中身だけ見ていると、2 回続けて add したときに再生されない。
  useEffect(() => {
    if (touched.length === 0) return;
    setLit(touched);
    const timer = setTimeout(() => setLit([]), reduce ? 0 : 1100);
    return () => clearTimeout(timer);
  }, [pulse, touched, reduce]);

  const head = headCommitId(state);
  const branch = currentBranchName(state);

  return (
    <div className="grid gap-3">
      <Pane
        id="workingDir"
        title="作業ディレクトリ"
        note="編集しただけで、まだ Git に渡していない"
        accent="var(--area-working)"
        tint="var(--tint-rose)"
        lit={lit.includes('workingDir')}
        empty="変更はありません"
        items={state.workingDir.map((f) => ({
          key: f.path,
          label: f.path,
          badge: f.status === 'untracked' ? 'untracked' : 'modified',
        }))}
      />

      <Arrow label="git add" lit={lit.includes('index')} />

      <Pane
        id="index"
        title="ステージ（index）"
        note="次のコミットに含めると決めた変更"
        accent="var(--area-index)"
        tint="var(--tint-amber)"
        lit={lit.includes('index')}
        empty="空です"
        items={state.index.map((f) => ({ key: f.path, label: f.path, badge: 'staged' }))}
      />

      <Arrow label="git commit" lit={lit.includes('repo')} />

      <Pane
        id="repo"
        title="リポジトリ"
        note="コミットとして確定した履歴"
        accent="var(--area-repo)"
        tint="var(--tint-lime)"
        lit={lit.includes('repo')}
        empty={state.initialized ? 'まだコミットがありません' : 'まだリポジトリがありません'}
        items={
          Object.keys(state.commits).length > 0
            ? [
                {
                  key: 'commits',
                  label: `コミット ${Object.keys(state.commits).length} 件`,
                  badge: `枝 ${state.branches.length} 本`,
                },
              ]
            : []
        }
      />

      <div
        data-pane="head"
        data-lit={lit.includes('head') ? 'true' : undefined}
        className={[
          'rounded-card border px-3 py-2 text-xs transition-colors duration-300',
          lit.includes('head') ? 'border-head bg-tint-amber' : 'border-line bg-elev',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-head">HEAD</span>
          <span className="font-mono text-[11px] text-muted">
            {!state.initialized
              ? '—'
              : branch && !head
                ? `${branch}（未誕生）`
                : branch
                  ? `${branch} → ${head}`
                  : `detached → ${head}`}
          </span>
        </div>
        {state.head.type === 'detached' && (
          <p className="mt-1 leading-relaxed text-detached">
            どの枝の上にもいません。ここでコミットしても、枝は伸びません。
          </p>
        )}
      </div>

      {state.remotes.length > 0 && <RemotePane state={state} />}

      {/*
        stash はグラフにも 3 領域にも現れない ― コミットを作らず、脇へどけるだけ。
        置き場所がないと「消えた」と誤解されるので、退避中だけここに出す。
      */}
      {state.stash.length > 0 && (
        <div
          data-pane="stash"
          className="rounded-card border border-tag bg-tint-violet px-3 py-2 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-tag">退避中（stash）</span>
            <span className="font-mono text-[11px] text-muted">{state.stash.length} 件</span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {[...state.stash].reverse().map((entry, i) => (
              <li key={entry.id} className="flex items-center justify-between gap-2">
                <code className="truncate font-mono text-[11px] text-fg">
                  stash&#123;{i}&#125; {entry.message}
                </code>
                <span className="shrink-0 text-[10px] text-muted">
                  {entry.index.length + entry.workingDir.length} 件
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 leading-relaxed text-muted">
            コミットではないので、グラフには出ません。git stash pop で戻せます。
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * リモートの様子。
 *
 * 「何個進んでいて、何個遅れているか」を出す。
 * push が通るのか pull が要るのかは、結局この 2 つの数で決まる。
 * 向こうだけが持っているコミットは、fetch するまでグラフに出ないので、
 * ここが唯一「まだ見えていないものがある」と知らせる場所になる。
 */
function RemotePane({ state }: { state: RepoState }) {
  const branch = currentBranchName(state);
  const local = branch ? (state.branches.find((b) => b.name === branch)?.target ?? null) : null;

  return (
    <div data-pane="remote" className="rounded-card border border-remote bg-tint-lime px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-remote">リモート</span>
        <span className="font-mono text-[11px] text-muted">
          {state.remotes.map((r) => r.name).join(', ')}
        </span>
      </div>

      <ul className="mt-1.5 space-y-1">
        {state.remotes.flatMap((remote) =>
          remote.branches.map((rb) => {
            const name = `${remote.name}/${rb.name}`;
            const known = state.remoteBranches.find((t) => t.name === name)?.target ?? null;
            // 手元がまだ fetch していないぶんは、追跡ブランチと向こうの先端のずれで分かる
            const unfetched = known !== rb.target;
            const { ahead, behind } =
              branch === rb.name ? aheadBehind(state, local, known) : { ahead: 0, behind: 0 };

            return (
              <li key={name}>
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate font-mono text-[11px] text-fg">{name}</code>
                  {branch === rb.name && (
                    <span className="shrink-0 text-[10px] text-muted">
                      進み {ahead} / 遅れ {behind}
                    </span>
                  )}
                </div>
                {unfetched && (
                  <p className="leading-relaxed text-muted">
                    向こうに、まだ持っていないコミットがあります。git fetch で見えます。
                  </p>
                )}
              </li>
            );
          }),
        )}
        {state.remotes.every((r) => r.branches.length === 0) && (
          <li className="text-muted">まだ何も送っていません（git push）。</li>
        )}
      </ul>
    </div>
  );
}

interface Item {
  key: string;
  label: string;
  badge: string;
}

/**
 * 領域 1 つ。
 *
 * 見出しの色は常にその領域のアクセントで、光っているかどうかでは変えない
 * ― 3 つの領域を色で覚えてもらいたいのに、その色が出たり消えたりしては覚えられない。
 * 「いま書き換わった」の合図は、枠線と下地の色でつける。
 */
function Pane({
  id,
  title,
  note,
  accent,
  tint,
  lit,
  items,
  empty,
}: {
  id: string;
  title: string;
  note: string;
  accent: string;
  tint: string;
  lit: boolean;
  items: Item[];
  empty: string;
}) {
  return (
    <section
      data-pane={id}
      data-lit={lit ? 'true' : undefined}
      className="rounded-card border px-3 py-2.5 transition-colors duration-300"
      style={{
        borderColor: lit ? accent : 'var(--border)',
        backgroundColor: lit ? tint : 'var(--bg-elev)',
      }}
      aria-live="polite"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold" style={{ color: accent }}>
          {title}
        </h3>
        <span className="text-[11px] text-muted">{items.length > 0 ? items.length : ''}</span>
      </header>
      <p className="mt-0.5 text-[11px] leading-snug text-muted">{note}</p>

      <ul className="mt-2 space-y-1">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.li
              key={item.key}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-between gap-2 overflow-hidden"
            >
              <code className="truncate font-mono text-xs text-fg">{item.label}</code>
              <span className="shrink-0 rounded border border-line px-1 text-[10px] text-muted">
                {item.badge}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
        {items.length === 0 && <li className="text-xs text-muted">{empty}</li>}
      </ul>
    </section>
  );
}

/** 領域と領域のあいだの矢印。どのコマンドが渡し役かを書いておく。 */
function Arrow({ label, lit }: { label: string; lit: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 text-[11px]">
      <span
        className="transition-colors duration-300"
        style={{ color: lit ? 'var(--text)' : 'var(--text-muted)' }}
      >
        ↓
      </span>
      <code
        className="font-mono transition-colors duration-300"
        style={{ color: lit ? 'var(--text)' : 'var(--text-muted)' }}
      >
        {label}
      </code>
    </div>
  );
}
