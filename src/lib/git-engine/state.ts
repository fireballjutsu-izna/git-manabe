import { changedPaths, copyTree } from './content';
import type {
  Area,
  Commit,
  CommandResult,
  FileState,
  Head,
  Ref,
  Remote,
  RepoState,
  Tree,
} from './types';

/** `git init` の前の状態。サンドボックスはここから始まる。 */
export function emptyState(): RepoState {
  return {
    initialized: false,
    commits: {},
    branches: [],
    tags: [],
    head: { type: 'branch', ref: 'main' },
    index: [],
    workingDir: [],
    work: {},
    stage: {},
    tracked: [],
    stash: [],
    remotes: [],
    remoteBranches: [],
    pausing: null,
    todo: null,
    bisect: null,
    reflog: [],
    seq: 0,
  };
}

/* ---- tree（ある時点の全ファイル）---- */

/** そのコミットの tree。null（unborn）なら空。 */
export function treeOf(state: RepoState, id: string | null): Tree {
  if (!id) return {};
  return state.commits[id]?.tree ?? {};
}

/** HEAD の tree。 */
export function headTree(state: RepoState): Tree {
  return treeOf(state, headCommitId(state));
}

export { copyTree };

/**
 * コミット id を作る。
 *
 * seq をそのまま出すと「id に順序の意味がある」と誤解されるので、見た目だけ散らす。
 * 乱数は使わない ― 同じコマンド列からは必ず同じ id が出るようにして、
 * テストとレベルの合格判定を安定させる。
 */
function hashId(seq: number): string {
  let h = 0x811c9dc5; // FNV-1a のオフセット基底
  const s = `koeda/${seq}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 7);
}

/**
 * 未使用の id を返す。
 * リモート側のコミットとも突き合わせる ― fetch で持ってきたときに
 * 手元の別コミットと id がぶつかると、履歴が壊れる。
 */
export function nextCommitId(state: RepoState): string {
  const taken = (id: string): boolean =>
    state.commits[id] !== undefined || state.remotes.some((r) => r.commits[id] !== undefined);

  let n = state.seq;
  let id = hashId(n);
  while (taken(id)) {
    n += 1;
    id = hashId(n);
  }
  return id;
}

/** HEAD が指しているコミット。unborn（まだ 1 つもコミットが無い）なら null。 */
export function headCommitId(state: RepoState): string | null {
  const head = state.head;
  if (head.type === 'detached') return head.oid;
  // 枝が見つからなければ unborn（`git init` 直後）
  return state.branches.find((b) => b.name === head.ref)?.target ?? null;
}

/** HEAD が枝の上にいるなら、その枝の名前。detached なら null。 */
export function currentBranchName(state: RepoState): string | null {
  return state.head.type === 'branch' ? state.head.ref : null;
}

export function findBranch(state: RepoState, name: string): Ref | undefined {
  return state.branches.find((b) => b.name === name);
}

/** そのコミットを指している ref をすべて集める（グラフのラベル用）。 */
export function refsAt(
  state: RepoState,
  commitId: string,
): { branches: string[]; tags: string[]; remotes: string[] } {
  return {
    branches: state.branches.filter((b) => b.target === commitId).map((b) => b.name),
    tags: state.tags.filter((t) => t.target === commitId).map((t) => t.name),
    remotes: state.remoteBranches.filter((r) => r.target === commitId).map((r) => r.name),
  };
}

export function findRemote(state: RepoState, name: string): Remote | undefined {
  return state.remotes.find((r) => r.name === name);
}

/** リモート追跡ブランチ（origin/main）を作る・移す。 */
export function setRemoteBranch(state: RepoState, name: string, target: string): RepoState {
  const exists = state.remoteBranches.some((r) => r.name === name);
  return {
    ...state,
    remoteBranches: exists
      ? state.remoteBranches.map((r) => (r.name === name ? { ...r, target } : r))
      : [...state.remoteBranches, { name, target }],
  };
}

/**
 * 手元がリモートより何個進んでいて、何個遅れているか。
 * `ahead 2, behind 1` の正体で、push できるか pull が要るかがこれで決まる。
 */
export function aheadBehind(
  state: RepoState,
  localTip: string | null,
  remoteTip: string | null,
): { ahead: number; behind: number } {
  if (!localTip) return { ahead: 0, behind: remoteTip ? ancestorsOf(state, remoteTip).size : 0 };
  if (!remoteTip) return { ahead: ancestorsOf(state, localTip).size, behind: 0 };
  const fromLocal = ancestorsOf(state, localTip);
  const fromRemote = ancestorsOf(state, remoteTip);
  return {
    ahead: [...fromLocal].filter((id) => !fromRemote.has(id)).length,
    behind: [...fromRemote].filter((id) => !fromLocal.has(id)).length,
  };
}

/**
 * コミット id を、前方一致でも引けるようにする。
 * `git checkout 3f2` のような短縮指定を受けるため。曖昧なら null を返す。
 */
export function resolveCommit(state: RepoState, spec: string): string | null | 'ambiguous' {
  if (state.commits[spec]) return spec;
  if (spec.length < 2) return null;
  const hits = Object.keys(state.commits).filter((id) => id.startsWith(spec));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return 'ambiguous';
  return null;
}

/**
 * 名前が枝でもタグでもコミットでもあり得る指定を、コミット id に解決する。
 *
 * `HEAD~2` や `main^` のような「そこから何代さかのぼるか」の書き方も受ける。
 * reset を教えるときにいちばん打つのが `git reset HEAD~1` なので、ここは要る。
 * ~ も ^ も第一親をたどる（マージコミットの ^2 のような指定までは踏み込まない）。
 */
export function resolveRevision(state: RepoState, spec: string): string | null | 'ambiguous' {
  // HEAD@{2} … reflog の 2 つ前。reset をやらかしたあとの戻り道になる
  const atReflog = spec.match(/^HEAD@\{(\d+)\}$/);
  if (atReflog) return reflogPosition(state, Number(atReflog[1]));

  const suffix = spec.match(/^(.*?)((?:[~^]\d*)+)$/);
  if (suffix) {
    const start = resolveRevision(state, suffix[1] || 'HEAD');
    if (start === null || start === 'ambiguous') return start;
    return walkBack(state, start, countSteps(suffix[2]));
  }

  if (spec === 'HEAD') return headCommitId(state);
  const branch = findBranch(state, spec);
  if (branch) return branch.target;
  const tag = state.tags.find((t) => t.name === spec);
  if (tag) return tag.target;
  // origin/main のような追跡ブランチも、ここから引ける。
  // git merge origin/main や git switch -c x origin/main を通すために要る。
  const remote = state.remoteBranches.find((r) => r.name === spec);
  if (remote) return remote.target;
  return resolveCommit(state, spec);
}

/**
 * `HEAD@{n}` が指すコミット。
 *
 * n = 0 はいまいる場所、n = 1 は「その 1 つ前に HEAD がいた場所」。
 * 親をさかのぼる ~ とは別物で、こちらは**時間**をさかのぼる。
 * だから rebase や reset で history から外れたコミットにも届く。
 */
function reflogPosition(state: RepoState, n: number): string | null {
  const newestFirst = [...state.reflog].reverse();
  if (newestFirst.length === 0) return null;
  if (n === 0) return newestFirst[0].to;
  const entry = newestFirst[n - 1];
  return entry ? entry.from : null;
}

/** `~2^` のような連なりが、合計で何代さかのぼるかを数える。 */
function countSteps(suffix: string): number {
  let steps = 0;
  for (const part of suffix.matchAll(/([~^])(\d*)/g)) {
    steps += part[2] === '' ? 1 : Number(part[2]);
  }
  return steps;
}

/** 第一親を n 代さかのぼる。根を越えたら null。 */
function walkBack(state: RepoState, from: string, steps: number): string | null {
  let cursor: string | undefined = from;
  for (let i = 0; i < steps; i += 1) {
    const commit: Commit | undefined = cursor ? state.commits[cursor] : undefined;
    cursor = commit?.parents[0];
    if (!cursor) return null;
  }
  return cursor ?? null;
}

/** そのコミットから第一親に限らず辿れる、すべての祖先（自分自身を含む）。 */
export function ancestorsOf(state: RepoState, id: string): Set<string> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (seen.has(current)) continue;
    const commit = state.commits[current];
    if (!commit) continue;
    seen.add(current);
    queue.push(...commit.parents);
  }
  return seen;
}

/** a は b の祖先か（同じコミットなら true）。 */
export function isAncestor(state: RepoState, a: string, b: string): boolean {
  return ancestorsOf(state, b).has(a);
}

/**
 * 2 つのコミットの共通の祖先のうち、いちばん新しいもの。
 * 3-way マージが「どこから分かれたか」を知るために使う。
 */
export function mergeBase(state: RepoState, a: string, b: string): string | null {
  const fromA = ancestorsOf(state, a);
  const shared = [...ancestorsOf(state, b)].filter((id) => fromA.has(id));
  if (shared.length === 0) return null;
  return shared.reduce((best, id) =>
    (state.commits[id]?.createdAt ?? 0) > (state.commits[best]?.createdAt ?? 0) ? id : best,
  );
}

/** from から辿れて to からは辿れないコミット（「この範囲だけに入っている変更」）。 */
export function commitsBetween(state: RepoState, to: string | null, from: string): string[] {
  const keep = to ? ancestorsOf(state, to) : new Set<string>();
  return [...ancestorsOf(state, from)].filter((id) => !keep.has(id));
}

/** そのコミットが第一親から変えたパス。tree の差から導く。 */
export function pathsOf(state: RepoState, id: string): string[] {
  const commit = state.commits[id];
  if (!commit) return [];
  return changedPaths(treeOf(state, commit.parents[0] ?? null), commit.tree);
}

/** そのコミット群が記録したパスを、重複なく集める。 */
export function pathsIn(state: RepoState, ids: string[]): string[] {
  const paths = new Set<string>();
  for (const id of ids) {
    for (const p of state.commits[id]?.paths ?? []) paths.add(p);
  }
  return [...paths];
}

/**
 * いずれかの ref（枝・タグ・HEAD）から辿れるコミット。
 *
 * ここに入らないコミットは「どこからも指されていない」＝ 迷子。
 * rebase でコピー元が置き去りになったときや、reset で切り離したときに出る。
 * 消えたわけではないことを見せたいので、グラフでは薄く描く。
 */
export function reachableCommits(state: RepoState): Set<string> {
  const roots = [
    ...state.branches.map((b) => b.target),
    ...state.tags.map((t) => t.target),
    // origin/main も立派な ref。fetch しただけのコミットを迷子扱いしない
    ...state.remoteBranches.map((r) => r.target),
    headCommitId(state),
  ].filter((id): id is string => id !== null);

  const seen = new Set<string>();
  for (const root of roots) {
    for (const id of ancestorsOf(state, root)) seen.add(id);
  }
  return seen;
}

/**
 * tracked を HEAD から数え直す。
 *
 * Git が「知っている」ファイルは、いまの HEAD から辿れる履歴に入っているものだけ。
 * reset で履歴を巻き戻したら、この集合も一緒に縮まないと、
 * 消えたはずのファイルが modified 扱いのまま残ってしまう。
 */
export function recomputeTracked(state: RepoState, head: string | null): string[] {
  if (!head) return [];
  return pathsIn(state, [...ancestorsOf(state, head)]).sort();
}

/**
 * 新しいコミットを 1 つ足した状態を返す。HEAD は動かさない（呼び出し側の責任）。
 *
 * paths は受け取らず、**第一親の tree との差から必ず計算する**。
 * 呼び出し側に任せると、tree と paths がずれた状態を作れてしまう。
 */
export function addCommit(
  state: RepoState,
  commit: Omit<Commit, 'createdAt' | 'paths'> & { createdAt?: number },
): RepoState {
  const seq = state.seq + 1;
  const parentTree = treeOf(state, commit.parents[0] ?? null);
  return {
    ...state,
    seq,
    commits: {
      ...state.commits,
      [commit.id]: {
        ...commit,
        createdAt: commit.createdAt ?? seq,
        paths: changedPaths(parentTree, commit.tree),
      },
    },
  };
}

/**
 * HEAD が動いた記録を残す。
 * HEAD を動かすコマンドは、例外なくここを通す。
 */
export function recordReflog(
  state: RepoState,
  op: string,
  message: string,
  from: string | null,
  to: string | null,
): RepoState {
  const seq = state.seq + 1;
  return {
    ...state,
    seq,
    reflog: [...state.reflog, { seq, from, to, op, message }],
  };
}

/** 枝を作る・移す。 */
export function setBranch(state: RepoState, name: string, target: string): RepoState {
  const exists = state.branches.some((b) => b.name === name);
  return {
    ...state,
    branches: exists
      ? state.branches.map((b) => (b.name === name ? { ...b, target } : b))
      : [...state.branches, { name, target }],
  };
}

export function removeBranch(state: RepoState, name: string): RepoState {
  return { ...state, branches: state.branches.filter((b) => b.name !== name) };
}

export function setHead(state: RepoState, head: Head): RepoState {
  return { ...state, head };
}

/* ---- 3 領域の出し入れ ---- */

export function setWorkingDir(state: RepoState, files: FileState[]): RepoState {
  return { ...state, workingDir: files };
}

export function setIndex(state: RepoState, files: FileState[]): RepoState {
  return { ...state, index: files };
}

/**
 * 3 領域を tree に合わせて作り直す。
 *
 * checkout・reset --hard・stash が使う ―「そのコミットそのままの状態」に戻すのは、
 * ファイルの中身まで含めて入れ替えることだから。
 */
export function loadTree(state: RepoState, tree: Tree): RepoState {
  return { ...state, work: copyTree(tree), stage: copyTree(tree), index: [], workingDir: [] };
}

/** そのパスを Git が知っている（一度でもコミットされた）か。 */
export function isTracked(state: RepoState, path: string): boolean {
  return state.tracked.includes(path);
}

/** 3 領域のどこかに、そのパスが既にあるか。 */
export function pathExists(state: RepoState, path: string): boolean {
  return (
    isTracked(state, path) ||
    state.workingDir.some((f) => f.path === path) ||
    state.index.some((f) => f.path === path)
  );
}

/* ---- コマンドの返り値を作るヘルパー ---- */

export function ok(state: RepoState, log: string[], touched: Area[] = []): CommandResult {
  return { state, log, touched };
}

/** 実行できなかったとき。state は素通しし、何も書き換えない。 */
export function fail(state: RepoState, error: string, hint?: string): CommandResult {
  return { state, log: hint ? [error, hint] : [error], error, touched: [] };
}

/** 止まっている作業の、続け方とやめ方。断り文句にも案内にも使う。 */
export function pausingWays(kind: 'merge' | 'rebase' | 'cherry-pick'): {
  label: string;
  next: string;
  abort: string;
} {
  if (kind === 'merge') {
    return { label: 'マージ', next: 'git commit', abort: 'git merge --abort' };
  }
  if (kind === 'rebase') {
    return { label: 'rebase', next: 'git rebase --continue', abort: 'git rebase --abort' };
  }
  return { label: 'cherry-pick', next: 'git cherry-pick --continue', abort: 'git cherry-pick --abort' };
}

/** 止まっている間は打てないコマンドの、共通の断り文句。 */
export function requireNoPause(state: RepoState): CommandResult | null {
  const pausing = state.pausing;
  if (!pausing) return null;
  const ways = pausingWays(pausing.kind);
  return fail(
    state,
    `${ways.label}の途中です。先に決着をつけてください。`,
    `ぶつかったファイルを git add してから ${ways.next} か、${ways.abort} でやめられます。`,
  );
}

/** `git init` が済んでいないときの、共通の断り文句。 */
export function requireRepo(state: RepoState): CommandResult | null {
  if (state.initialized) return null;
  return fail(
    state,
    'ここはまだ Git のリポジトリではありません。',
    'まず git init を実行してください。',
  );
}
