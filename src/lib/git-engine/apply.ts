import { changedPaths, copyTree, mergeTrees } from './content';
import { currentBranchName, headCommitId, ok, pausingWays, treeOf } from './state';
import type {
  CommandResult,
  ConflictFile,
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

  const lines = [
    `${names.length} 件がぶつかりました: ${names.join(', ')}`,
    '両側が同じ行を変えています。どちらを残すかは Git には決められません。',
    `${ways.label}は途中で止まっています。壊れてはいません。`,
    '',
    'ぶつかったファイルには、こういう目印が書き込まれています:',
    ...markerSample(pausing.conflicts[0], pausing),
    '',
    `目印を消して残す中身を 1 つに決めたら、git add してから ${ways.next} です。`,
    `片側をまるごと選ぶなら git checkout --ours <path> / --theirs <path> が早いです。`,
    `やめるなら ${ways.abort}。始める前の状態に戻ります。`,
  ];

  if (autoStaged.length > 0) {
    lines.splice(3, 0, `ぶつからなかった ${autoStaged.length} 件は、もうステージに載っています。`);
  }

  return ok(
    { ...state, work: copyTree(tree), stage, index, workingDir, pausing },
    lines,
    ['workingDir', 'index'],
  );
}

/** 目印の見本。実際に書き込まれた中身から、そのまま抜き出す。 */
function markerSample(conflict: ConflictFile | undefined, pausing: Pausing): string[] {
  if (!conflict) return [];
  return [
    `  <<<<<<< ${oursLabelOf(pausing)}`,
    ...conflict.ours.slice(0, 2).map((l) => `  ${l}`),
    '  =======',
    ...conflict.theirs.slice(0, 2).map((l) => `  ${l}`),
    `  >>>>>>> ${pausing.from}`,
  ];
}

export function oursLabelOf(pausing: Pausing): string {
  // rebase は「積む先」がこちら側になるので、HEAD と書くと逆に見える
  return pausing.kind === 'rebase' ? '積む先' : 'HEAD';
}
