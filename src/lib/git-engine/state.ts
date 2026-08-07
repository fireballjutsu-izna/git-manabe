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

/** 名前が枝でもタグでもコミットでもあり得る指定を、コミット id に解決する。 */
export function resolveRevision(state: RepoState, spec: string): string | null | 'ambiguous' {
  if (spec === 'HEAD') return headCommitId(state);
  const branch = findBranch(state, spec);
  if (branch) return branch.target;
  const tag = state.tags.find((t) => t.name === spec);
  if (tag) return tag.target;
  return resolveCommit(state, spec);
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
