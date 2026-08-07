import { currentBranchName, headCommitId, ok, refsAt, requireRepo } from '../state';
import type { CommandResult, RepoState } from '../types';

/**
 * `git log`
 *
 * HEAD から親を辿れるコミットだけを、新しい順に出す。
 * 「別の枝のコミットは見えない」ことが log のいちばん大事な性質なので、
 * 全コミットを並べるのではなく、必ず HEAD から辿る。
 */
export function log(state: RepoState): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const head = headCommitId(state);
  if (!head) {
    return ok(state, ['まだコミットがありません。'], []);
  }

  // HEAD から親をすべて辿る（マージコミットに備えて 2 親以上も歩く）
  const seen = new Set<string>();
  const queue = [head];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of state.commits[id]?.parents ?? []) queue.push(p);
  }

  const ordered = [...seen]
    .map((id) => state.commits[id])
    .filter((c) => c !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt);

  const branch = currentBranchName(state);
  const lines: string[] = [];

  for (const c of ordered) {
    const { branches, tags } = refsAt(state, c.id);
    const labels = [
      ...(c.id === head ? [branch ? `HEAD -> ${branch}` : 'HEAD'] : []),
      ...branches.filter((b) => b !== branch || c.id !== head),
      ...tags.map((t) => `tag: ${t}`),
    ];
    const suffix = labels.length > 0 ? ` (${labels.join(', ')})` : '';
    lines.push(`${c.id}${suffix} ${c.message}`);
  }

  lines.push('');
  lines.push(`${ordered.length} 件。ここから辿れないコミットは出ません。`);

  return ok(state, lines, []);
}
