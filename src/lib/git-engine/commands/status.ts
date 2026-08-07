import { currentBranchName, headCommitId, ok, refsAt, requireRepo } from '../state';
import type { CommandResult, RepoState } from '../types';

/**
 * `git status`
 *
 * 3 領域の現在地を言葉で出す。画面の 3 領域パネルと同じことを言うが、
 * 「本物の Git ならこう出る」を先に覚えてほしいので、両方置く。
 */
export function status(state: RepoState): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const lines: string[] = [];
  const head = headCommitId(state);
  const branch = currentBranchName(state);

  if (branch && !head) {
    lines.push(`いる場所: ${branch}（まだコミットがありません）`);
  } else if (branch) {
    lines.push(`いる場所: ${branch}（${head}）`);
  } else {
    lines.push(`いる場所: detached HEAD（${head}）`);
    lines.push('どの枝の上にもいません。ここでのコミットは、どの枝からも辿れなくなります。');
  }

  if (state.index.length > 0) {
    lines.push('');
    lines.push('コミットされる変更（ステージにあるもの）:');
    for (const f of state.index) lines.push(`  ${f.path}`);
  }

  const modified = state.workingDir.filter((f) => f.status === 'modified');
  if (modified.length > 0) {
    lines.push('');
    lines.push('ステージされていない変更:');
    for (const f of modified) lines.push(`  ${f.path}`);
  }

  const untracked = state.workingDir.filter((f) => f.status === 'untracked');
  if (untracked.length > 0) {
    lines.push('');
    lines.push('Git がまだ知らないファイル:');
    for (const f of untracked) lines.push(`  ${f.path}`);
  }

  if (state.index.length === 0 && state.workingDir.length === 0) {
    lines.push('');
    lines.push('変更はありません。作業ディレクトリもステージも空です。');
  }

  if (head) {
    const { branches, tags } = refsAt(state, head);
    const labels = [...branches, ...tags.map((t) => `tag:${t}`)];
    if (labels.length > 1) {
      lines.push('');
      lines.push(`このコミットを指している名前: ${labels.join(', ')}`);
    }
  }

  return ok(state, lines, []);
}
