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

  /*
   * マージの途中は、いちばん先に言う。
   *
   * 本物の Git もここを最初に出す ― 何が起きているか分からないまま
   * 次のコマンドを打つのが、コンフリクトでいちばん怖い瞬間なので。
   */
  const merging = state.merging;
  if (merging) {
    lines.push('');
    lines.push(`${merging.from} の取り込みが途中で止まっています。`);
    if (merging.conflicts.length > 0) {
      lines.push('決着のついていないファイル:');
      for (const p of merging.conflicts) lines.push(`  両方が変更: ${p}`);
      lines.push('直したら git add してください。全部片付くと git commit できます。');
    } else {
      lines.push('ぶつかっていたファイルは全部片付いています。git commit でマージを完了できます。');
    }
    lines.push('やめるなら git merge --abort です。');
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
