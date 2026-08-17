import { currentBranchName, headCommitId, isAncestor, type RepoState } from '@/lib/git-engine';

/**
 * 達成条件を書くための道具。
 *
 * シナリオの check は 20 個以上あるので、同じ問い合わせを毎回書かない。
 * どれも「いまの状態に、こう聞く」だけの読み取り関数。
 */

/** その枝が指しているコミット。無ければ null。 */
export function tipOf(state: RepoState, branch: string): string | null {
  return state.branches.find((b) => b.name === branch)?.target ?? null;
}

/** その枝の先端に載っているメッセージ。 */
export function tipMessage(state: RepoState, branch: string): string | null {
  const tip = tipOf(state, branch);
  return tip ? (state.commits[tip]?.message ?? null) : null;
}

/** いまいる枝の名前が、これか。 */
export function on(state: RepoState, branch: string): boolean {
  return currentBranchName(state) === branch;
}

/** その枝が存在するか。 */
export function hasBranch(state: RepoState, branch: string): boolean {
  return state.branches.some((b) => b.name === branch);
}

/** into の側から from が辿れるか（＝ 取り込み済みか）。 */
export function contains(state: RepoState, into: string, from: string): boolean {
  const a = tipOf(state, into);
  const b = tipOf(state, from);
  return a !== null && b !== null && isAncestor(state, b, a);
}

/** その枝から、そのコミットが辿れるか。追跡ブランチ相手のときに使う。 */
export function containsCommit(state: RepoState, branch: string, commit: string | null): boolean {
  const tip = tipOf(state, branch);
  return tip !== null && commit !== null && isAncestor(state, commit, tip);
}

/** その枝が、いくつコミットを重ねているか（根からの第一親の数）。 */
export function depth(state: RepoState, branch: string): number {
  let cursor = tipOf(state, branch);
  let n = 0;
  while (cursor && state.commits[cursor]) {
    n += 1;
    cursor = state.commits[cursor].parents[0];
  }
  return n;
}

/** HEAD の載っているコミットの親の数。マージコミットかどうかを見るのに使う。 */
export function headParents(state: RepoState): number {
  const head = headCommitId(state);
  return head ? (state.commits[head]?.parents.length ?? 0) : 0;
}

/** 作業ディレクトリとステージが、どちらも空か。 */
export function areasClean(state: RepoState): boolean {
  return state.workingDir.length === 0 && state.index.length === 0;
}

/** リモートの、その枝の先端。 */
export function remoteTip(state: RepoState, branch: string, remote = 'origin'): string | null {
  return state.remotes.find((r) => r.name === remote)?.branches.find((b) => b.name === branch)
    ?.target ?? null;
}

/** 追跡ブランチ（origin/main など）が指している先。 */
export function trackingTip(state: RepoState, name = 'origin/main'): string | null {
  return state.remoteBranches.find((r) => r.name === name)?.target ?? null;
}
