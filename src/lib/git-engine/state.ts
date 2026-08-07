import type { Area, Commit, CommandResult, FileState, Head, Ref, RepoState } from './types';

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
    tracked: [],
    stash: [],
    reflog: [],
    seq: 0,
  };
}

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

/** 未使用の id を返す。7 桁なので実質ぶつからないが、念のため衝突を避ける。 */
export function nextCommitId(state: RepoState): string {
  let n = state.seq;
  let id = hashId(n);
  while (state.commits[id]) {
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
export function refsAt(state: RepoState, commitId: string): { branches: string[]; tags: string[] } {
  return {
    branches: state.branches.filter((b) => b.target === commitId).map((b) => b.name),
    tags: state.tags.filter((t) => t.target === commitId).map((t) => t.name),
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
  return resolveCommit(state, spec);
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

/** 新しいコミットを 1 つ足した状態を返す。HEAD は動かさない（呼び出し側の責任）。 */
export function addCommit(
  state: RepoState,
  commit: Omit<Commit, 'createdAt'> & { createdAt?: number },
): RepoState {
  const seq = state.seq + 1;
  return {
    ...state,
    seq,
    commits: {
      ...state.commits,
      [commit.id]: { ...commit, createdAt: commit.createdAt ?? seq },
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

/** `git init` が済んでいないときの、共通の断り文句。 */
export function requireRepo(state: RepoState): CommandResult | null {
  if (state.initialized) return null;
  return fail(
    state,
    'ここはまだ Git のリポジトリではありません。',
    'まず git init を実行してください。',
  );
}
