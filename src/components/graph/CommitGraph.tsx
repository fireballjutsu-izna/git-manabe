'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { layoutGraph, type RepoState } from '@/lib/git-engine';

/* 格子 1 マスの大きさ。数十コミット規模を想定した寸法にしている。 */
const COL_W = 104;
const LANE_H = 118;
const PAD_X = 44;
const PAD_BOTTOM = 52; // id とメッセージを node の下に出すぶん
const NODE_R = 15;
const BADGE_H = 24; // バッジ 1 段ぶんの高さ

/**
 * 上の余白は、いちばん多くの名前が付いたコミットに合わせて広げる。
 * 固定にすると、1 つのコミットに main と hotfix が同時に付いた瞬間に
 * 上のバッジが枠の外へ出て切れる。
 */
function padTop(maxStack: number): number {
  return 47 + maxStack * BADGE_H;
}

interface Placed {
  id: string;
  cx: number;
  cy: number;
}

const px = (x: number): number => PAD_X + x * COL_W;

/** メッセージは長いと隣とぶつかるので、この長さで丸める。 */
function short(message: string): string {
  return message.length > 9 ? `${message.slice(0, 9)}…` : message;
}

export function CommitGraph({ state }: { state: RepoState }) {
  const reduce = useReducedMotion();
  const layout = layoutGraph(state);

  const spring = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 320, damping: 30 } as const);

  if (layout.nodes.length === 0) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-card border border-dashed border-line px-6 py-12 text-center text-sm text-muted">
        {state.initialized ? (
          <p>
            まだコミットがありません。
            <br />
            <code className="font-mono text-fg">git commit -m &quot;はじめ&quot;</code> を打つと、
            ここに最初のコミットと <span className="text-branch">main</span> が現れます。
          </p>
        ) : (
          <p>
            まだリポジトリがありません。
            <br />
            <code className="font-mono text-fg">git init</code> から始めてください。
          </p>
        )}
      </div>
    );
  }

  const labels = labelsFor(state);
  const maxStack = labels.reduce((m, l) => Math.max(m, l.stack), 0);
  const top = padTop(maxStack);

  const placed = new Map<string, Placed>();
  for (const n of layout.nodes) {
    placed.set(n.id, { id: n.id, cx: px(n.x), cy: top + n.y * LANE_H });
  }

  const width = PAD_X * 2 + (layout.cols - 1) * COL_W;
  const height = top + PAD_BOTTOM + (layout.lanes - 1) * LANE_H;

  const headOid = state.head.type === 'detached' ? state.head.oid : null;
  const headBranch = state.head.type === 'branch' ? state.head.ref : null;

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-sunken">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`コミットグラフ。コミット ${layout.nodes.length} 件、枝 ${state.branches.length} 本。`}
        className="block"
        data-testid="commit-graph"
      >
        {/* 辺（親 → 子）。新しく張られた辺は、線が伸びるように描く */}
        <g>
          <AnimatePresence>
            {layout.edges.map((e) => {
              const from = placed.get(e.from);
              const to = placed.get(e.to);
              if (!from || !to) return null;
              return (
                <motion.path
                  key={`${e.from}->${e.to}`}
                  d={edgePath(from, to)}
                  fill="none"
                  stroke="var(--commit-dim)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.35, ease: 'easeOut' }}
                />
              );
            })}
          </AnimatePresence>
        </g>

        {/* コミット */}
        <AnimatePresence>
          {layout.nodes.map((n) => {
            const p = placed.get(n.id)!;
            const commit = state.commits[n.id];
            const isHead = headOid === n.id || (headBranch && branchTarget(state, headBranch) === n.id);
            // 親が 2 つ ＝ マージコミット。二重丸にして、線が 2 本入る先を目立たせる
            const isMerge = (commit?.parents.length ?? 0) > 1;
            return (
              <motion.g
                key={n.id}
                data-commit={n.id}
                initial={reduce ? false : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={spring}
                style={{ transformOrigin: `${p.cx}px ${p.cy}px` }}
              >
                <motion.circle
                  animate={{ cx: p.cx, cy: p.cy }}
                  initial={{ cx: p.cx, cy: p.cy }}
                  transition={spring}
                  r={NODE_R}
                  fill="var(--bg-elev)"
                  stroke={isHead ? 'var(--head)' : 'var(--commit)'}
                  strokeWidth={isHead ? 3 : 2}
                />
                {isMerge && (
                  <motion.circle
                    animate={{ cx: p.cx, cy: p.cy }}
                    initial={{ cx: p.cx, cy: p.cy }}
                    transition={spring}
                    r={NODE_R - 5}
                    fill="none"
                    stroke={isHead ? 'var(--head)' : 'var(--commit)'}
                    strokeWidth={1.5}
                  />
                )}
                <text
                  x={p.cx}
                  y={p.cy + NODE_R + 16}
                  textAnchor="middle"
                  className="fill-[var(--text-muted)] font-mono text-[11px]"
                >
                  {n.id}
                </text>
                <text
                  x={p.cx}
                  y={p.cy + NODE_R + 31}
                  textAnchor="middle"
                  className="fill-[var(--text-muted)] text-[11px]"
                >
                  {short(commit?.message ?? '')}
                </text>
                <title>
                  {`${n.id}  ${commit?.message ?? ''}${isMerge ? '（マージコミット・親が 2 つ）' : ''}`}
                </title>
              </motion.g>
            );
          })}
        </AnimatePresence>

        {/* 枝・タグ・HEAD のラベル。ref が別のコミットへ移ると、飛んでいくように見える */}
        <AnimatePresence>
          {labels.map((label) => {
            const p = placed.get(label.target);
            if (!p) return null;
            const y = p.cy - NODE_R - 10 - label.stack * BADGE_H;
            return (
              <motion.g
                key={label.key}
                data-ref={label.key}
                data-ref-target={label.target}
                initial={reduce ? false : { opacity: 0, y: y + 12, x: p.cx }}
                animate={{ opacity: 1, x: p.cx, y }}
                exit={{ opacity: 0 }}
                transition={spring}
              >
                <RefBadge text={label.text} tone={label.tone} />
              </motion.g>
            );
          })}
        </AnimatePresence>
      </svg>

      <Legend hasMerge={Object.values(state.commits).some((c) => c.parents.length > 1)} />
    </div>
  );
}

/**
 * 凡例。
 * 色だけで意味を伝えると、色が見分けにくい人に何も伝わらない。
 * 形と言葉でも同じことを言っておく。
 */
function Legend({ hasMerge }: { hasMerge: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-muted">
      <li>
        <span className="text-branch">■</span> 枝
      </li>
      <li>
        <span className="text-head">■</span> HEAD（いまいる場所）
      </li>
      <li>
        <span className="text-detached">▨</span> detached HEAD（枝の外）
      </li>
      {hasMerge && <li>◎ マージコミット（親が 2 つ）</li>}
    </ul>
  );
}

function branchTarget(state: RepoState, name: string): string | null {
  return state.branches.find((b) => b.name === name)?.target ?? null;
}

/** 親から子へ。レーンが違うときだけ、なめらかに曲げる。 */
function edgePath(from: Placed, to: Placed): string {
  if (from.cy === to.cy) return `M ${from.cx} ${from.cy} L ${to.cx} ${to.cy}`;
  const mid = (from.cx + to.cx) / 2;
  return `M ${from.cx} ${from.cy} C ${mid} ${from.cy}, ${mid} ${to.cy}, ${to.cx} ${to.cy}`;
}

type Tone = 'branch' | 'head' | 'tag' | 'detached';

interface Label {
  key: string;
  text: string;
  tone: Tone;
  target: string;
  /** 同じコミットに複数の名前が付いたとき、何段目に積むか。 */
  stack: number;
}

/**
 * コミットに付くラベルを組み立てる。
 *
 * HEAD が枝を指しているときは、その枝のバッジに `HEAD →` を付けて 1 つにまとめる。
 * detached のときだけ HEAD が独立したバッジになる ― この見た目の違いが、
 * 「いま枝の上にいるのか、いないのか」をひと目で分からせる。
 */
function labelsFor(state: RepoState): Label[] {
  const labels: Label[] = [];
  const stackAt = new Map<string, number>();

  const push = (target: string, text: string, tone: Tone, key: string): void => {
    const stack = stackAt.get(target) ?? 0;
    stackAt.set(target, stack + 1);
    labels.push({ key, text, tone, target, stack });
  };

  if (state.head.type === 'detached') {
    push(state.head.oid, 'HEAD', 'detached', 'ref:HEAD');
  }

  const headBranch = state.head.type === 'branch' ? state.head.ref : null;
  for (const b of state.branches) {
    const isHead = b.name === headBranch;
    push(b.target, isHead ? `HEAD → ${b.name}` : b.name, isHead ? 'head' : 'branch', `ref:${b.name}`);
  }
  for (const t of state.tags) {
    push(t.target, t.name, 'tag', `tag:${t.name}`);
  }

  return labels;
}

const TONE: Record<Tone, { stroke: string; fill: string; text: string; dashed?: boolean }> = {
  branch: { stroke: 'var(--branch)', fill: 'var(--tint-cyan)', text: 'var(--branch)' },
  head: { stroke: 'var(--head)', fill: 'var(--tint-amber)', text: 'var(--head)' },
  tag: { stroke: 'var(--tag)', fill: 'var(--tint-violet)', text: 'var(--tag)' },
  detached: {
    stroke: 'var(--detached)',
    fill: 'var(--tint-rose)',
    text: 'var(--detached)',
    dashed: true,
  },
};

/** バッジ 1 つ。原点が中心の下端になるように描く。 */
function RefBadge({ text, tone }: { text: string; tone: Tone }) {
  const style = TONE[tone];
  // 日本語が混ざらない前提でだいたいの幅を出す。SVG の中で測るのは高くつく。
  const w = Math.max(38, text.length * 7.4 + 14);
  return (
    <g>
      <rect
        x={-w / 2}
        y={-18}
        width={w}
        height={20}
        rx={5}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={1.5}
        strokeDasharray={style.dashed ? '4 3' : undefined}
      />
      <text
        x={0}
        y={-4}
        textAnchor="middle"
        fill={style.text}
        className="font-mono text-[11px] font-bold"
      >
        {text}
      </text>
    </g>
  );
}
