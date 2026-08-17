'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bucket, Storefront, Workbench } from '@/components/ui/ShopIcons';
import {
  aheadBehind,
  currentBranchName,
  headCommitId,
  pausingWays,
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
  /**
   * 見た目の切り替え。
   *
   * florist はシナリオ専用。**見出しは git の言葉のまま**にして、
   * 店の言い方は note に添えるだけにする ―
   * 覚えてほしいのは git の語彙で、店の言い方はその手がかりにすぎない。
   */
  theme = 'plain',
}: {
  state: RepoState;
  touched: Area[];
  pulse: number;
  theme?: 'plain' | 'florist';
}) {
  const shop = theme === 'florist';
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
      {/*
        止まっているときは、いちばん上に出す。
        3 領域より先に目に入らないと、「何が起きたのか分からないまま次を打つ」になる。
      */}
      {state.pausing && <PausePane state={state} />}

      <Pane
        id="workingDir"
        title="作業ディレクトリ"
        note={
          shop
            ? '作業台 ― 手を入れただけで、まだ Git に渡していない'
            : '編集しただけで、まだ Git に渡していない'
        }
        icon={shop ? <Workbench /> : undefined}
        accent="var(--area-working)"
        tint="var(--tint-rose)"
        lit={lit.includes('workingDir')}
        empty="変更はありません"
        items={state.workingDir.map((f) => ({
          key: f.path,
          label: f.path,
          badge: f.status === 'conflicted' ? '両方が変更' : f.status,
          alert: f.status === 'conflicted',
          // Git が見ていないものは薄く。並んでいるのに関係ない、を色で言う
          faded: f.status === 'ignored',
          hint: firstLine(state.work[f.path]),
        }))}
      />

      <Arrow label="git add" lit={lit.includes('index')} />

      <Pane
        id="index"
        title="ステージ（index）"
        note={
          shop ? 'バケツ ― 次に出すと決めたぶん' : '次のコミットに含めると決めた変更'
        }
        icon={shop ? <Bucket /> : undefined}
        accent="var(--area-index)"
        tint="var(--tint-amber)"
        lit={lit.includes('index')}
        empty="空です"
        items={state.index.map((f) => ({
          key: f.path,
          label: f.path,
          // 「外す」もステージに載る。入れるのと見分けが付かないと、読み違える
          badge: f.status === 'deleted' ? '追跡をやめる' : 'staged',
          hint: firstLine(state.stage[f.path]),
        }))}
      />

      <Arrow label="git commit" lit={lit.includes('repo')} />

      <Pane
        id="repo"
        title="リポジトリ"
        note={shop ? '店頭 ― 出したものの記録' : 'コミットとして確定した履歴'}
        icon={shop ? <Storefront /> : undefined}
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
          <span className="font-mono text-xs sm:text-[11px] text-muted">
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
            <span className="font-mono text-xs sm:text-[11px] text-muted">{state.stash.length} 件</span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {[...state.stash].reverse().map((entry, i) => (
              <li key={entry.id} className="flex items-center justify-between gap-2">
                <code className="truncate font-mono text-xs sm:text-[11px] text-fg">
                  stash&#123;{i}&#125; {entry.message}
                </code>
                <span className="shrink-0 text-xs sm:text-[10px] text-muted">
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
        <span className="font-mono text-xs sm:text-[11px] text-muted">
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
                  <code className="truncate font-mono text-xs sm:text-[11px] text-fg">{name}</code>
                  {branch === rb.name && (
                    <span className="shrink-0 text-xs sm:text-[10px] text-muted">
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

/**
 * 途中で止まっている merge / rebase / cherry-pick。
 *
 * ここで伝えたいことは 1 つだけ ―「止まっているだけで、壊れていない」。
 * 出口が 2 つ（決着をつける／やめる）あることを、両方その場に書いておく。
 * 続け方は 3 つで違うので、いま止まっているものに合わせて出す。
 */
function PausePane({ state }: { state: RepoState }) {
  const pausing = state.pausing;
  if (!pausing) return null;

  const ways = pausingWays(pausing.kind);
  const done = pausing.conflicts.length === 0;
  // rebase は 1 件ずつ当て直すので、あと何回止まりうるかを出す
  const left = Math.max(0, pausing.remaining.length - 1);

  return (
    <div
      data-pane="pausing"
      data-pause-kind={pausing.kind}
      className="rounded-card border border-detached bg-tint-rose px-3 py-2 text-xs"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-detached">
          {ways.label}が途中で止まっています
        </span>
        <code className="shrink-0 truncate font-mono text-xs sm:text-[11px] text-muted">{pausing.from}</code>
      </div>

      {done ? (
        <p className="mt-1 leading-relaxed text-fg">
          全部片付きました。<code className="font-mono">{ways.next}</code> で先へ進めます。
        </p>
      ) : (
        <>
          <ul className="mt-1.5 space-y-0.5">
            {pausing.conflicts.map((c) => (
              <li key={c.path} className="flex items-center justify-between gap-2">
                <code className="truncate font-mono text-xs sm:text-[11px] text-fg">{c.path}</code>
                <span className="shrink-0 rounded border border-detached px-1 text-xs sm:text-[10px] text-detached">
                  同じ行を両方が変更
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 leading-relaxed text-muted">
            ファイルには <code className="font-mono text-fg">&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>{' '}
            の目印が書き込まれています。
            <code className="font-mono text-fg"> git checkout --ours </code>か
            <code className="font-mono text-fg"> --theirs </code>で片側を選ぶか、
            <code className="font-mono text-fg"> edit </code>で自分で書いてから
            <code className="font-mono text-fg"> git add </code>
            してください。
          </p>
        </>
      )}

      {left > 0 && (
        <p className="mt-1 leading-relaxed text-muted">
          このあと、あと {left} 件を当て直します。途中でまた止まることがあります。
        </p>
      )}

      <p className="mt-1 leading-relaxed text-muted">
        コミットは 1 つも増えていません。
        <code className="font-mono text-fg"> {ways.abort} </code>
        で、始める前の状態に戻せます。
      </p>
    </div>
  );
}

interface Item {
  key: string;
  label: string;
  badge: string;
  /** 目を引かせたいもの（いまはコンフリクトだけ）。 */
  alert?: boolean;
  /** ホバーで出す、中身の 1 行目。 */
  hint?: string;
  /** Git が見ていないもの（ignored）。薄く出す。 */
  faded?: boolean;
}

/**
 * 中身の見出し 1 行。
 *
 * パネルは「どこに何があるか」を見せる場所なので、中身は常時は出さない。
 * ただしホバーで読めると、ステージと作業ディレクトリで中身が違うことに気付ける
 * ― add したあとに編集すると起きる、いちばん分かりにくい状態がこれ。
 */
function firstLine(content: string[] | undefined): string | undefined {
  if (!content || content.length === 0) return undefined;
  const head = content.find((line) => line.trim().length > 0) ?? content[0];
  return content.length > 1 ? `${head}  （全 ${content.length} 行）` : head;
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
  icon,
}: {
  id: string;
  title: string;
  note: string;
  accent: string;
  tint: string;
  lit: boolean;
  items: Item[];
  empty: string;
  icon?: React.ReactNode;
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
        <h3 className="flex items-center gap-1.5 text-sm font-bold" style={{ color: accent }}>
          {icon}
          {title}
        </h3>
        <span className="text-xs sm:text-[11px] text-muted">{items.length > 0 ? items.length : ''}</span>
      </header>
      <p className="mt-0.5 text-xs sm:text-[11px] leading-snug text-muted">{note}</p>

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
              style={item.faded ? { opacity: 0.5 } : undefined}
            >
              <code className="truncate font-mono text-xs text-fg" title={item.hint}>
                {item.label}
              </code>
              <span
                className={[
                  'shrink-0 rounded border px-1 text-xs sm:text-[10px]',
                  item.alert
                    ? 'border-detached text-detached'
                    : 'border-line text-muted',
                ].join(' ')}
              >
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
    <div className="flex items-center justify-center gap-2 text-xs sm:text-[11px]">
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
