import { ok, reachableCommits, requireRepo } from '../state';
import type { CommandResult, RepoState } from '../types';

/**
 * `git reflog`
 *
 * HEAD が通ってきた場所の記録。
 *
 * 枝やタグと違って、これは**自分の手元にしか無い**私的な記録。
 * だからこそ「どこからも辿れなくなったコミット」への最後の道になる。
 * `git reset --hard` でやらかしたあとに戻れるのは、ここに id が残っているから。
 *
 * 順番は git に合わせて新しい順。HEAD@{0} がいまいる場所。
 */
export function reflog(state: RepoState): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  if (state.reflog.length === 0) {
    return ok(state, ['まだ HEAD が動いていません。'], []);
  }

  const reachable = reachableCommits(state);
  const newestFirst = [...state.reflog].reverse();
  const lines: string[] = [];
  const lost: string[] = [];

  newestFirst.forEach((entry, i) => {
    const oid = entry.to ?? '(なし)';
    const orphan = entry.to !== null && !reachable.has(entry.to);
    if (orphan && !lost.includes(entry.to as string)) lost.push(entry.to as string);
    lines.push(
      `${oid} HEAD@{${i}}: ${entry.op}: ${entry.message}${orphan ? '  ← いま辿れません' : ''}`,
    );
  });

  lines.push('');
  lines.push(`${newestFirst.length} 件。HEAD@{0} がいまいる場所。`);

  if (lost.length > 0) {
    lines.push('');
    lines.push('「いま辿れません」と付いたコミットは、消えたわけではありません。');
    lines.push(`戻すなら git reset --hard ${lost[0]}、`);
    lines.push(`いまの場所を残したまま拾うなら git switch -c 救出 ${lost[0]} です。`);
  }

  return ok(state, lines, []);
}
