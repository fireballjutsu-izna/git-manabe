'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { bisectRange, layoutGraph, reachableCommits, type RepoState } from '@/lib/git-engine';

/*
 * 上から下へ 1 行 1 コミット。レーンは左の細い帯に横並び。
 * git log --graph や IDE の Git Graph と同じ向きで、
 * **いま打ったコミットが必ず最上段に出る**ので、追うのにスクロールが要らない。
 */
const LANE_W = 26; // レーンの間隔
const ROW_H = 42; // 1 行の高さ
const PAD_X = 20;
const PAD_Y = 16;
const GUTTER = 20; // レーンの帯と、id・メッセージのあいだ
const NODE_R = 8;
const ID_W = 66; // id を出す幅（7 桁の等幅）
const MSG_W = 168; // メッセージを出す幅

interface Placed {
  id: string;
  cx: number;
  cy: number;
}

/** 用意してあるレーン色の数。これを超えたら先頭から巡回する。 */
const LANE_COLORS = 6;

/**
 * そのレーンの線の色。
 *
 * Git Graph や GitKraken と同じで、流れごとに色を変えて追えるようにする。
 * ref の色（枝＝シアン、HEAD＝アンバー…）とは意味が別なので、
 * これは**線と丸にだけ**使い、バッジには乗せない。
 */
function laneColor(lane: number): string {
  return `var(--lane-${lane % LANE_COLORS})`;
}

/**
 * バッジのおおよその幅。
 * SVG の中で実測するのは高くつくので、文字数から見積もる。
 * 描画（RefBadge）と幅の計算で、必ず同じ値を使う。
 *
 * 半角と全角で幅が倍ほど違うので、分けて数える。
 * 一律 7.4px で見積もっていた頃は、日本語の枝名（救出 など）や
 * bisect の判定バッジが、枠から溢れて出ていた。
 */
function badgeWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[\u0020-\u007e]/.test(ch) ? 7.4 : 11;
  return Math.max(38, w + 14);
}

/** メッセージは長いとバッジとぶつかるので、この長さで丸める。 */
function short(message: string): string {
  return message.length > 18 ? `${message.slice(0, 18)}…` : message;
}

export function CommitGraph({
  state,
  /**
   * 見た目の切り替え。
   *
   * florist はシナリオ専用。レベルとサンドボックスは plain のままにして、
   * 本物の git log --graph に近い見え方を保つ。
   */
  theme = 'plain',
}: {
  state: RepoState;
  theme?: 'plain' | 'florist';
}) {
  const reduce = useReducedMotion();
  const layout = layoutGraph(state);

  /* 位置が変わるとき用。行き過ぎない、落ち着いたばね */
  const spring = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 320, damping: 30 } as const);

  /*
   * 出てくるとき用。damping を下げて**わざと行き過ぎさせる**。
   * 「増えた」ことを一瞬で気付かせたいので、落ち着くより目立つほうを取る。
   */
  const entry = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 260, damping: 11, mass: 0.7 } as const);

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
  const laneBand = layout.lanes * LANE_W;
  const infoX = PAD_X + laneBand + GUTTER;
  const badgeX = infoX + ID_W + MSG_W;

  const placed = new Map<string, Placed>();
  for (const n of layout.nodes) {
    placed.set(n.id, {
      id: n.id,
      cx: PAD_X + n.lane * LANE_W + LANE_W / 2,
      cy: PAD_Y + n.row * ROW_H + ROW_H / 2,
    });
  }
  const laneOf = new Map(layout.nodes.map((n) => [n.id, n.lane]));

  /* 同じ行に付くバッジを横に並べるので、いちばん長い行に合わせて幅を決める */
  const badgeRun = new Map<string, number>();
  for (const label of labels) {
    const run = badgeRun.get(label.target) ?? 0;
    badgeRun.set(label.target, run + badgeWidth(label.text) + 6);
  }
  const widestBadges = Math.max(0, ...badgeRun.values());

  const width = badgeX + widestBadges + PAD_X;
  const height = PAD_Y * 2 + layout.rows * ROW_H;

  const headOid = state.head.type === 'detached' ? state.head.oid : null;
  const headBranch = state.head.type === 'branch' ? state.head.ref : null;
  const headTarget = headOid ?? (headBranch ? branchTarget(state, headBranch) : null);
  const headAt = headTarget ? placed.get(headTarget) : undefined;

  /*
   * 同じコミットへ入ってくる辺の、何本目か。
   * マージは 2 本が同時に伸びると 1 本に見えてしまうので、
   * 2 本目だけ遅らせて、順に合流したことが分かるようにする。
   */
  const incomingIndex = new Map<string, number>();
  const incomingCount = new Map<string, number>();
  for (const e of layout.edges) {
    const n = incomingCount.get(e.to) ?? 0;
    incomingIndex.set(`${e.from}->${e.to}`, n);
    incomingCount.set(e.to, n + 1);
  }

  /*
   * どの ref からも辿れなくなったコミット。
   * rebase でコピー元が置き去りになったときと、reset で切り離したときに出る。
   * 「消えたのではなく、指されなくなっただけ」を見せたいので、消さずに薄く描く。
   */
  const reachable = reachableCommits(state);
  const orphaned = layout.nodes.filter((n) => !reachable.has(n.id)).length;

  /*
   * 二分探索中は、まだ「最初に壊れたコミット」かもしれない範囲に帯を敷く。
   *
   * このコマンドで起きているのは**範囲が半分ずつ狭まっていく**ことなので、
   * それが目に見えないと、ただ HEAD が飛び回っているようにしか見えない。
   * good / bad と答えるたびに帯が縮むのが、そのままアルゴリズムの説明になる。
   */
  const bisecting = state.bisect;
  const searching = bisecting ? new Set(bisectRange(state, bisecting)) : null;

  /** 同じコミットに付くバッジの、何番目か。横に並べる位置を決めるのに使う。 */
  const runningX = new Map<string, number>();

  return (
    /*
      min-w-0 が無いと、グリッドの子は min-width:auto のまま ―
      中の SVG の幅にひきずられて、狭い画面で本文ごと横にはみ出す。
      内側の overflow-auto だけでは止まらない。
    */
    <div className="min-w-0 rounded-card border border-line bg-sunken">
      {/* 履歴が伸びると縦に長くなる。新しいものが上なので、上端が見えていればよい */}
      <div className="max-h-[26rem] overflow-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`コミットグラフ。コミット ${layout.nodes.length} 件、枝 ${state.branches.length} 本。新しいものが上です。`}
          className="block"
          data-testid="commit-graph"
        >
          {/* 探索の範囲。いちばん下に敷いて、線にも丸にもかからないようにする */}
          <AnimatePresence>
            {searching &&
              layout.nodes
                .filter((n) => searching.has(n.id))
                .map((n) => (
                  <motion.rect
                    key={`range:${n.id}`}
                    x={0}
                    y={PAD_Y + n.row * ROW_H}
                    width={width}
                    height={ROW_H}
                    fill="var(--bisect-range)"
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.3 }}
                  />
                ))}
          </AnimatePresence>

          {/* 辺（親 → 子）。新しく張られた辺は、線が伸びるように描く */}
          <g>
            <AnimatePresence>
              {layout.edges.map((e) => {
                const from = placed.get(e.from);
                const to = placed.get(e.to);
                if (!from || !to) return null;
                // 線の色は「どのレーンへ向かうか」で決める。
                // そうすると、枝分かれした線が最後まで同じ色で追える。
                const lane = laneOf.get(e.to) ?? 0;
                const nth = incomingIndex.get(`${e.from}->${e.to}`) ?? 0;
                return (
                  <motion.path
                    key={`${e.from}->${e.to}`}
                    d={edgePath(from, to)}
                    fill="none"
                    stroke={laneColor(lane)}
                    strokeLinecap="round"
                    strokeOpacity={reachable.has(e.to) ? 1 : 0.34}
                    // 太さも 0 から育てる。線が「伸びる」だけでなく「太る」ので、
                    // 短い辺（親が 1 行上）でも動きとして見える
                    initial={reduce ? false : { pathLength: 0, opacity: 0, strokeWidth: 0 }}
                    animate={{ pathLength: 1, opacity: 1, strokeWidth: 2 }}
                    exit={{ opacity: 0 }}
                    transition={
                      reduce
                        ? { duration: 0 }
                        : { duration: 0.42, ease: 'easeOut', delay: nth * 0.16 }
                    }
                  />
                );
              })}
            </AnimatePresence>
          </g>

          {/* コミット 1 行ぶん */}
          <AnimatePresence>
            {layout.nodes.map((n) => {
              const p = placed.get(n.id)!;
              const commit = state.commits[n.id];
              const isHead =
                headOid === n.id || (headBranch && branchTarget(state, headBranch) === n.id);
              // 親が 2 つ ＝ マージコミット。線が 2 本入る先を目立たせる
              const isMerge = (commit?.parents.length ?? 0) > 1;
              const isOrphan = !reachable.has(n.id);
              const color = isHead ? 'var(--head)' : laneColor(n.lane);

              return (
                <motion.g
                  key={n.id}
                  data-commit={n.id}
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: isOrphan ? 0.4 : 1 }}
                  exit={{ opacity: 0 }}
                  transition={spring}
                >
                  {/*
                    マージの波紋。合流点から 1 回だけ広がる。
                    2 本目の辺が入り終わる頃に出したいので、少し遅らせる。
                    ― 「2 つが 1 つに束ねられた」のは、静止画では伝わらないので。
                  */}
                  {isMerge && !reduce && (
                    <motion.circle
                      cx={p.cx}
                      cy={p.cy}
                      r={NODE_R}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      initial={{ scale: 0.5, opacity: 0.9 }}
                      animate={{ scale: 3.6, opacity: 0 }}
                      transition={{ duration: 0.95, delay: 0.45, ease: 'easeOut' }}
                      style={{ transformOrigin: `${p.cx}px ${p.cy}px` }}
                    />
                  )}

                  {/*
                    出てくるときの動き。
                      florist … つぼみが 1 枚ずつ開く（Node の側でずらす）
                      plain   … 行き過ぎてから戻る
                    どちらも迷子になった瞬間に傾いて、少し落ちる。
                    マージはそのうえで 1 度だけ脈打つ。
                  */}
                  <motion.g
                    initial={
                      reduce ? false : { scale: 0.25, rotate: theme === 'florist' ? -60 : 0 }
                    }
                    animate={{
                      scale: isMerge && !reduce ? [1, 1.34, 1] : 1,
                      rotate: isOrphan ? (theme === 'florist' ? 22 : 12) : 0,
                      // 迷子は枝から外れて落ちたので、行の中で少し下へずらす
                      y: isOrphan ? 5 : 0,
                    }}
                    transition={
                      isMerge && !reduce
                        ? { scale: { duration: 0.6, times: [0, 0.42, 1], delay: 0.4 }, rotate: spring, y: spring }
                        : entry
                    }
                    style={{ transformOrigin: `${p.cx}px ${p.cy}px` }}
                  >
                    <Node
                      theme={theme}
                      cx={p.cx}
                      cy={p.cy}
                      color={color}
                      isHead={Boolean(isHead)}
                      isMerge={isMerge}
                      isOrphan={isOrphan}
                      animated={!reduce}
                    />
                  </motion.g>

                  <text
                    x={infoX}
                    y={p.cy + 4}
                    className="fill-[var(--text-muted)] font-mono text-[11px]"
                  >
                    {n.id}
                  </text>
                  <text
                    x={infoX + ID_W}
                    y={p.cy + 4}
                    className="fill-[var(--text-muted)] text-[11px]"
                  >
                    {short(commit?.message ?? '')}
                  </text>

                  <title>
                    {`${n.id}  ${commit?.message ?? ''}${
                      isMerge ? '（マージコミット・親が 2 つ）' : ''
                    }${isOrphan ? '（どの枝からも辿れません）' : ''}`}
                  </title>
                </motion.g>
              );
            })}
          </AnimatePresence>

          {/*
            HEAD が移った先で、輪が 1 回広がる。
            key に移り先の id を入れてあるので、HEAD が動くたびに
            古い輪が外れて新しい輪が生まれる ― それが、そのまま合図になる。
          */}
          <AnimatePresence>
            {headAt && !reduce && (
              <motion.circle
                key={`head-ring:${headAt.id}`}
                cx={headAt.cx}
                cy={headAt.cy}
                r={NODE_R + 2}
                fill="none"
                stroke="var(--head)"
                strokeWidth={2.5}
                initial={{ scale: 0.6, opacity: 0.95 }}
                animate={{ scale: 2.8, opacity: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                style={{ transformOrigin: `${headAt.cx}px ${headAt.cy}px` }}
              />
            )}
          </AnimatePresence>

          {/* 枝・タグ・HEAD のラベル。ref が別のコミットへ移ると、飛んでいくように見える */}
          <AnimatePresence>
            {labels.map((label) => {
              const p = placed.get(label.target);
              if (!p) return null;
              const offset = runningX.get(label.target) ?? 0;
              runningX.set(label.target, offset + badgeWidth(label.text) + 6);
              return (
                /*
                  縦と横で、ばねの硬さをわざと変えてある。
                  横が遅れて追いつくので、まっすぐではなく**弧を描いて**飛ぶ。
                  キーフレームで中間点を置く手もあるが、それだと
                  「いまどこにいるか」を毎回自分で数えることになるので、こちらにした。
                */
                <motion.g
                  key={label.key}
                  data-ref={label.key}
                  data-ref-target={label.target}
                  initial={reduce ? false : { y: p.cy }}
                  animate={{ y: p.cy }}
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 17 }}
                >
                  <motion.g
                    initial={reduce ? false : { opacity: 0, x: badgeX + offset + 26, scale: 0.7 }}
                    animate={{ opacity: 1, x: badgeX + offset, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={
                      reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 14 }
                    }
                  >
                    <RefBadge text={label.text} tone={label.tone} />
                  </motion.g>
                </motion.g>
              );
            })}
          </AnimatePresence>
        </svg>
      </div>

      <Legend
        hasMerge={Object.values(state.commits).some((c) => c.parents.length > 1)}
        orphaned={orphaned}
        lanes={layout.lanes}
        hasRemote={state.remoteBranches.length > 0}
        searching={searching?.size ?? 0}
        theme={theme}
      />
    </div>
  );
}

/**
 * コミット 1 つの印。
 *
 * plain は丸（マージは二重丸）。florist は花で、マージは八重咲き。
 * どちらも中心は同じ位置・同じ大きさに収める ― 見た目が変わっても、
 * 線のつながりと行の高さは同じでなければ読み方が変わってしまう。
 */
function Node({
  theme,
  cx,
  cy,
  color,
  isHead,
  isMerge,
  isOrphan,
  animated,
}: {
  theme: 'plain' | 'florist';
  cx: number;
  cy: number;
  color: string;
  isHead: boolean;
  isMerge: boolean;
  isOrphan: boolean;
  animated: boolean;
}) {
  const dash = isOrphan ? '3 2.5' : undefined;

  if (theme === 'florist') {
    return (
      <g data-bloom="true">
        {/* 八重咲き ＝ マージ。花弁を 2 層にして、線が 2 本入る先だと分かるようにする */}
        {isMerge && (
          <Petals
            cx={cx}
            cy={cy}
            r={NODE_R + 2.5}
            rotate={36}
            color={color}
            faint
            animated={animated}
            scattered={isOrphan}
            // 内側が開き切ってから外側。八重が「重なって」咲いて見える
            delay={0.18}
          />
        )}
        <Petals
          cx={cx}
          cy={cy}
          r={NODE_R + 1.5}
          rotate={0}
          color={color}
          dash={dash}
          animated={animated}
          scattered={isOrphan}
        />
        <circle cx={cx} cy={cy} r={isHead ? 3.4 : 2.6} fill={color} />
      </g>
    );
  }

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={NODE_R}
        fill="var(--bg-elev)"
        // HEAD だけは「いまいる場所」という意味の色を優先する
        stroke={color}
        strokeWidth={isHead ? 3 : 2}
        // 破線にして、色が見分けにくくても迷子だと分かるようにする
        strokeDasharray={dash}
      />
      {isMerge && (
        <circle cx={cx} cy={cy} r={NODE_R - 3.5} fill="none" stroke={color} strokeWidth={1.4} />
      )}
    </g>
  );
}

/** 花弁 5 枚。 */
const PETAL_ANGLES = [0, 72, 144, 216, 288];

function Petals({
  cx,
  cy,
  r,
  rotate,
  color,
  dash,
  faint,
  animated,
  scattered,
  delay = 0,
}: {
  cx: number;
  cy: number;
  r: number;
  rotate: number;
  color: string;
  dash?: string;
  faint?: boolean;
  animated: boolean;
  /** どの枝からも辿れなくなった花。花弁が外へ散る。 */
  scattered?: boolean;
  delay?: number;
}) {
  return (
    <g opacity={faint ? 0.5 : 1}>
      {PETAL_ANGLES.map((deg, i) => (
        /*
          回転は外側の <g> に SVG の属性で持たせ、動きは内側だけに付ける。
          こうすると内側では「上が外向き」になるので、
          散るときの向きが花弁ごとに y の 1 本だけで書ける。
        */
        <g key={deg} transform={`rotate(${deg + rotate} ${cx} ${cy})`}>
          <motion.ellipse
            cx={cx}
            cy={cy - r * 0.52}
            rx={r * 0.38}
            ry={r * 0.56}
            fill="var(--bg-elev)"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={dash}
            // 中心を軸に縮めておくと、開くときに「つぼみがほどける」ように見える
            initial={animated ? { scale: 0, opacity: 0 } : false}
            animate={{
              scale: 1,
              opacity: 1,
              y: scattered ? -r * 0.9 : 0,
              rotate: scattered ? 14 : 0,
            }}
            transition={
              animated
                ? { type: 'spring', stiffness: 320, damping: 13, delay: delay + i * 0.07 }
                : { duration: 0 }
            }
            style={{ transformOrigin: `${cx}px ${cy}px` }}
          />
        </g>
      ))}
    </g>
  );
}

/**
 * 凡例。
 * 色だけで意味を伝えると、色が見分けにくい人に何も伝わらない。
 * 形と言葉でも同じことを言っておく。
 */
function Legend({
  hasMerge,
  orphaned,
  lanes,
  hasRemote,
  searching,
  theme,
}: {
  hasMerge: boolean;
  orphaned: number;
  lanes: number;
  hasRemote: boolean;
  /** 二分探索の範囲に入っているコミットの数。0 なら探索していない。 */
  searching: number;
  theme: 'plain' | 'florist';
}) {
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
      {hasRemote && (
        <li>
          <span className="text-remote">■</span> リモート追跡（origin/…）
        </li>
      )}
      {lanes > 1 && <li>線の色 ＝ 流れの区別</li>}
      {hasMerge && (
        <li>{theme === 'florist' ? '八重咲き' : '◎'} ＝ マージコミット（親が 2 つ）</li>
      )}
      {searching > 0 && (
        <li data-legend="bisect">
          帯 ＝ まだ「最初に壊れた」かもしれない範囲（{searching} 件）。
          <span className="text-[var(--bisect-good)]">✓ 動いた</span> ・
          <span className="text-[var(--bisect-bad)]">✗ 壊れた</span> と答えるたびに狭まります
        </li>
      )}
      {orphaned > 0 && (
        <li>
          <span className="opacity-40">{theme === 'florist' ? '傾いた花' : '◌'}</span>
          ・破線 ＝ どの枝からも辿れないコミット（{orphaned} 件・消えてはいません）
        </li>
      )}
    </ul>
  );
}

function branchTarget(state: RepoState, name: string): string | null {
  return state.branches.find((b) => b.name === name)?.target ?? null;
}

/** 親から子へ。レーンが違うときだけ、なめらかに曲げる。 */
function edgePath(from: Placed, to: Placed): string {
  if (from.cx === to.cx) return `M ${from.cx} ${from.cy} L ${to.cx} ${to.cy}`;
  const mid = (from.cy + to.cy) / 2;
  return `M ${from.cx} ${from.cy} C ${from.cx} ${mid}, ${to.cx} ${mid}, ${to.cx} ${to.cy}`;
}

type Tone = 'branch' | 'head' | 'tag' | 'detached' | 'remote' | 'good' | 'bad' | 'skip';

interface Label {
  key: string;
  text: string;
  tone: Tone;
  target: string;
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

  if (state.head.type === 'detached') {
    labels.push({ key: 'ref:HEAD', text: 'HEAD', tone: 'detached', target: state.head.oid });
  }

  const headBranch = state.head.type === 'branch' ? state.head.ref : null;
  for (const b of state.branches) {
    const isHead = b.name === headBranch;
    labels.push({
      key: `ref:${b.name}`,
      text: isHead ? `HEAD → ${b.name}` : b.name,
      tone: isHead ? 'head' : 'branch',
      target: b.target,
    });
  }
  for (const t of state.tags) {
    labels.push({ key: `tag:${t.name}`, text: t.name, tone: 'tag', target: t.target });
  }
  // origin/main。手元の枝より後ろにいることがあり、そのずれが「pull が要る」の正体
  for (const r of state.remoteBranches) {
    labels.push({ key: `remote:${r.name}`, text: r.name, tone: 'remote', target: r.target });
  }

  /*
   * bisect で答えた判定。
   *
   * いま調べている場所は detached HEAD のバッジが指しているので、ここには出さない。
   * 出すのは**もう答えたところ**だけ ― 挟み込みが両側から狭まっていくのが見えればよい。
   */
  const bisect = state.bisect;
  if (bisect) {
    const face = {
      good: { text: '✓ 動いた', tone: 'good' as const },
      bad: { text: '✗ 壊れた', tone: 'bad' as const },
      skip: { text: '－ 保留', tone: 'skip' as const },
    };
    for (const [id, verdict] of Object.entries(bisect.verdicts)) {
      if (!state.commits[id]) continue;
      labels.push({ key: `bisect:${id}`, text: face[verdict].text, tone: face[verdict].tone, target: id });
    }
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
  remote: { stroke: 'var(--remote)', fill: 'var(--tint-lime)', text: 'var(--remote)' },
  /*
   * bisect の判定。ref の色とは意味の層が違うので、専用の色を使う。
   * 記号（✓ ✗ －）も入れてあるので、色が見分けにくくても読める。
   */
  good: {
    stroke: 'var(--bisect-good)',
    fill: 'var(--tint-bisect-good)',
    text: 'var(--bisect-good)',
  },
  bad: { stroke: 'var(--bisect-bad)', fill: 'var(--tint-bisect-bad)', text: 'var(--bisect-bad)' },
  skip: {
    stroke: 'var(--commit-dim)',
    fill: 'var(--bg-elev)',
    text: 'var(--text-muted)',
    dashed: true,
  },
};

/** バッジ 1 つ。原点が左端・行の中心になるように描く。 */
function RefBadge({ text, tone }: { text: string; tone: Tone }) {
  const style = TONE[tone];
  const w = badgeWidth(text);
  return (
    <g>
      <rect
        x={0}
        y={-10}
        width={w}
        height={20}
        rx={5}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={1.5}
        strokeDasharray={style.dashed ? '4 3' : undefined}
      />
      <text
        x={w / 2}
        y={4}
        textAnchor="middle"
        fill={style.text}
        className="font-mono text-[11px] font-bold"
      >
        {text}
      </text>
    </g>
  );
}
