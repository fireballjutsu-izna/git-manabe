import {
  changedPaths,
  conflictBlocks,
  copyTree,
  mergeContent,
  mergeTrees,
  OURS_MARK,
  SPLIT_MARK,
  THEIRS_MARK,
  type ConflictKind,
} from './content';
import { currentBranchName, headCommitId, joinJa, ok, pausingWays, treeOf } from './state';
import type {
  CommandResult,
  ConflictFile,
  Content,
  FileState,
  Pausing,
  RepoState,
  Tree,
} from './types';

/**
 * 「3 つの版を 1 つにする」を、merge・rebase・cherry-pick・revert で共有する。
 *
 * 4 つとも、やっていることは同じ:
 *
 *   merge        base = 分岐点        ours = HEAD      theirs = 相手の枝
 *   rebase       base = 当てる元の親  ours = 積む先    theirs = 当てる元
 *   cherry-pick  base = 摘む元の親    ours = HEAD      theirs = 摘む元
 *   revert       base = 打ち消す元    ours = HEAD      theirs = 打ち消す元の親
 *
 * 入れるものが違うだけなので、ぶつかったときの止まり方も同じ形にできる。
 */
export interface Applied {
  tree: Tree;
  conflicts: ConflictFile[];
}

export function applyOnto(
  state: RepoState,
  baseId: string | null,
  oursId: string | null,
  theirsId: string | null,
  oursLabel: string,
  theirsLabel: string,
): Applied {
  const merged = mergeTrees(
    treeOf(state, baseId),
    treeOf(state, oursId),
    treeOf(state, theirsId),
    oursLabel,
    theirsLabel,
  );
  return { tree: merged.tree, conflicts: merged.conflicts };
}

/** revert 用。theirs に「打ち消す元の親」を入れると、逆向きの変更になる。 */
export function applyReverse(
  state: RepoState,
  targetId: string,
  oursId: string,
  oursLabel: string,
  theirsLabel: string,
): Applied {
  const target = state.commits[targetId];
  return applyOnto(state, targetId, oursId, target?.parents[0] ?? null, oursLabel, theirsLabel);
}

/** --abort で戻すための、いまの状態。 */
export function snapshot(state: RepoState): Pausing['saved'] {
  const branch = currentBranchName(state);
  return {
    index: state.index,
    workingDir: state.workingDir,
    work: copyTree(state.work),
    stage: copyTree(state.stage),
    head: state.head,
    branchTarget: branch ? (state.branches.find((b) => b.name === branch)?.target ?? null) : null,
  };
}

/** --abort。止まる前の状態を、そっくり戻す。 */
export function restore(state: RepoState, pausing: Pausing): RepoState {
  const saved = pausing.saved;
  const branch = saved.head.type === 'branch' ? saved.head.ref : null;
  return {
    ...state,
    pausing: null,
    head: saved.head,
    branches:
      branch && saved.branchTarget
        ? state.branches.map((b) =>
            b.name === branch ? { ...b, target: saved.branchTarget as string } : b,
          )
        : state.branches,
    index: saved.index,
    workingDir: saved.workingDir,
    work: copyTree(saved.work),
    stage: copyTree(saved.stage),
  };
}

/**
 * ぶつかったので止まる。
 *
 * 作業ディレクトリには目印の入った中身をそのまま置く ―
 * 「ファイルを開いたら <<<<<<< が入っていた」という、実物と同じ体験にする。
 * ぶつからなかったファイルは、もう決まっているのでステージに載せておく。
 */
export function pauseWith(
  state: RepoState,
  pausing: Omit<Pausing, 'conflicts'> & { conflicts: ConflictFile[] },
  tree: Tree,
): CommandResult {
  const oursTree = treeOf(state, headCommitId(state));
  const conflicted = new Set(pausing.conflicts.map((c) => c.path));

  // ぶつからなかったぶんだけステージに載せる。ぶつかったパスは決着待ち
  const stage: Tree = {};
  for (const [path, content] of Object.entries(tree)) {
    stage[path] = conflicted.has(path) ? [...(oursTree[path] ?? content)] : [...content];
  }

  const autoStaged = changedPaths(oursTree, stage).filter((p) => !conflicted.has(p));
  const index: FileState[] = autoStaged.map((path) => ({ path, status: 'staged' }));
  const workingDir: FileState[] = [
    ...state.workingDir.filter((f) => !conflicted.has(f.path) && !autoStaged.includes(f.path)),
    ...[...conflicted].sort().map((path) => ({ path, status: 'conflicted' as const })),
  ];

  const ways = pausingWays(pausing.kind);
  const names = pausing.conflicts.map((c) => c.path);
  const first = pausing.conflicts[0];

  const lines = [
    `${names.length} 件がぶつかりました: ${names.join(', ')}`,
    ...reasonLines(state, pausing),
    joinJa(ways.label, 'は途中で止まっています。壊れてはいません。'),
  ];

  if (autoStaged.length > 0) {
    lines.push(`ぶつからなかった ${autoStaged.length} 件は、もうステージに載っています。`);
  }

  lines.push(
    '',
    joinJa(first ? first.path : 'ぶつかったファイル', 'には、こういう目印が書き込まれています:'),
    ...markerSample(first ? tree[first.path] : undefined, pausing),
    '',
    `目印を消して残す中身を 1 つに決めたら、git add してから ${ways.next} です。`,
    `片側をまるごと選ぶなら git checkout --ours <path> / --theirs <path> が早いです。`,
    `やめるなら ${ways.abort}。始める前の状態に戻ります。`,
  );

  return ok(
    { ...state, work: copyTree(tree), stage, index, workingDir, pausing },
    lines,
    ['workingDir', 'index'],
  );
}

/** ぶつかり方ごとの言い分け。「同じ行」と決めつけると、たいていの場合に嘘になる。 */
const REASONS: Record<ConflictKind, string> = {
  'file-deleted':
    '片側がこのファイルを消し、もう片側は中身を変えています。消すか残すかは、Git には決められません。',
  'line-deleted':
    '片側が消した行を、もう片側が変えています。消すか残すかは、Git には決められません。',
  'both-added':
    '両側が同じ場所に、別々の行を足しています。どちらを先にするかは、Git には決められません。',
  'same-line':
    '両側が同じ行を、別々の中身に変えています。どちらを残すかは、Git には決められません。',
  nearby:
    '両側が変えた行が隣り合っていて、切り分けられません。間に 1 行でも変えていない行が残っていれば、黙って両方入ります。',
};

/**
 * なぜぶつかったのかを、起きたことに合わせて言う。
 *
 * 理由はマージし直せば分かる ― pausing.base は、そのとき使った分岐点そのもの。
 * ConflictFile に理由を持たせるより、ここで引き直すほうが持ち物が増えない。
 */
function reasonLines(state: RepoState, pausing: Pausing): string[] {
  const baseTree = treeOf(state, pausing.base);
  const kinds: ConflictKind[] = [];

  for (const conflict of pausing.conflicts) {
    // mergeTrees は、消えた側の中身を空にして渡してくる
    if (conflict.ours.length === 0 || conflict.theirs.length === 0) {
      kinds.push('file-deleted');
      continue;
    }
    const merged = mergeContent(baseTree[conflict.path], conflict.ours, conflict.theirs, '', '');
    kinds.push(...merged.kinds);
  }

  // 何件ぶつかっても、読ませたいのは理由の種類。同じ理由は 1 度だけ言う
  return [...new Set(kinds)].slice(0, 3).map((kind) => REASONS[kind]);
}

/**
 * 目印の見本。実際に書き込まれた中身から、ぶつかった箇所をそのまま抜き出す。
 *
 * 前は各側の先頭 2 行を出していたので、ぶつかった箇所が下のほうにあると
 * 両側にまったく同じ 2 行が並んだ ― 見比べて選べというのに、違いが見えなかった。
 */
function markerSample(content: Content | undefined, pausing: Pausing): string[] {
  const blocks = conflictBlocks(content);
  const block = blocks[0];
  if (!block) return [];

  const lines = [
    `  ${OURS_MARK} ${oursLabelOf(pausing)}`,
    ...sampleSide(block.ours),
    `  ${SPLIT_MARK}`,
    ...sampleSide(block.theirs),
    `  ${THEIRS_MARK} ${pausing.from}`,
  ];
  if (blocks.length > 1) {
    lines.push(`  （このファイルには、あと ${blocks.length - 1} か所あります）`);
  }
  return lines;
}

/** ターミナルなので、片側が長いときは頭だけ。1 行省くために「ほか 1 行」と書くのは損。 */
function sampleSide(side: Content): string[] {
  const head = 3;
  if (side.length <= head + 1) return side.map((l) => `  ${l}`);
  return [...side.slice(0, head).map((l) => `  ${l}`), `  …（ほか ${side.length - head} 行）`];
}

export function oursLabelOf(pausing: Pausing): string {
  // rebase は「積む先」がこちら側になるので、HEAD と書くと逆に見える
  return pausing.kind === 'rebase' ? '積む先' : 'HEAD';
}
