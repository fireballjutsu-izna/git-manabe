import { currentBranchName, headCommitId, ok, refsAt, requireRepo } from '../state';
import { flagValue, type ParsedCommand } from '../parse';
import type { Commit, CommandResult, RepoState } from '../types';

/**
 * `git log`
 *
 * HEAD から親を辿れるコミットだけを、新しい順に出す。
 * 「別の枝のコミットは見えない」ことが log のいちばん大事な性質なので、
 * 全コミットを並べるのではなく、必ず HEAD から辿る。
 *
 *   --oneline   id とメッセージだけ
 *   -n <数>     件数を絞る（-3 のようにも書ける）
 *   --all       HEAD から辿れないものも出す
 *
 * --all がいちばん学習に効く。reset や rebase で見えなくなったコミットが
 * **消えたのではなく、辿れなくなっただけ**だと、その場で確かめられる。
 */
export function log(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const oneline = command.flags['--oneline'] === true;
  const all = command.flags['--all'] === true;
  const limit = countLimit(command);

  const head = headCommitId(state);
  if (!head && !all) {
    return ok(state, ['まだコミットがありません。'], []);
  }
  if (Object.keys(state.commits).length === 0) {
    return ok(state, ['まだコミットがありません。'], []);
  }

  const reachable = ancestorsFrom(state, head);
  const shown = all ? Object.values(state.commits) : [...reachable].map((id) => state.commits[id]);

  const ordered = shown
    .filter((c): c is Commit => c !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt);

  const limited = limit === null ? ordered : ordered.slice(0, limit);
  const branch = currentBranchName(state);
  const lines: string[] = [];

  for (const c of limited) {
    const { branches, tags } = refsAt(state, c.id);
    const labels = [
      ...(c.id === head ? [branch ? `HEAD -> ${branch}` : 'HEAD'] : []),
      ...branches.filter((b) => b !== branch || c.id !== head),
      ...tags.map((t) => `tag: ${t}`),
    ];
    const suffix = labels.length > 0 ? ` (${labels.join(', ')})` : '';
    // --all のときだけ、辿れないものに印を付ける。これが無いと区別が付かない
    const lost = all && !reachable.has(c.id) ? '  ← ここからは辿れません' : '';

    if (oneline) {
      lines.push(`${c.id}${suffix} ${c.message}${lost}`);
      continue;
    }

    // 既定の書式は本物と同じ組。--oneline との差がひと目で分かるようにする。
    // 空行は各件の「前」に入れる ― 末尾に入れると、後ろの件数表示と二重になる
    if (lines.length > 0) lines.push('');
    lines.push(`commit ${c.id}${suffix}`);
    if (c.parents.length > 1) lines.push(`Merge: ${c.parents.join(' ')}`);
    lines.push(`    ${c.message}${lost}`);
  }

  lines.push('');
  if (limit !== null && ordered.length > limit) {
    lines.push(`${limit} 件（全 ${ordered.length} 件のうち）。`);
  } else {
    lines.push(`${ordered.length} 件。`);
  }

  if (all) {
    const lost = ordered.filter((c) => !reachable.has(c.id)).length;
    lines.push(
      lost > 0
        ? `--all なので、ここから辿れない ${lost} 件も出しています。消えてはいません。`
        : '--all で全部見ていますが、辿れないコミットはありません。',
    );
  } else {
    lines.push('ここから辿れないコミットは出ません。--all を付けると出ます。');
  }

  return ok(state, lines, []);
}

/** HEAD から辿れるコミット。マージコミットに備えて 2 親以上も歩く。 */
function ancestorsFrom(state: RepoState, head: string | null): Set<string> {
  const seen = new Set<string>();
  if (!head) return seen;

  const queue = [head];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of state.commits[id]?.parents ?? []) queue.push(p);
  }
  return seen;
}

/**
 * `-n 3` と `-3` の両方を受ける。
 *
 * パーサは値を取るフラグを知らないので、`-n 3` は
 * flags['-n'] = true ／ positional = ['3'] に分かれて届く。
 * ここは log でしか要らないので、パーサ側は触らずここで拾う。
 */
function countLimit(command: ParsedCommand): number | null {
  // -3 のような書き方
  for (const key of Object.keys(command.flags)) {
    const short = key.match(/^-(\d+)$/);
    if (short) return positive(short[1]);
  }

  const value = flagValue(command, '-n', '--max-count');
  if (value === undefined) return null;
  return typeof value === 'string' ? positive(value) : positive(command.positional[0]);
}

function positive(text: string | undefined): number | null {
  if (text === undefined) return null;
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : null;
}
