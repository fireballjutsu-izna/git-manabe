import { hasFlag, type ParsedCommand } from '../parse';
import { currentBranchName, headCommitId, ok, pausingWays, refsAt, requireRepo } from '../state';
import type { CommandResult, RepoState } from '../types';

/**
 * `git status`
 *
 * 3 領域の現在地を言葉で出す。画面の 3 領域パネルと同じことを言うが、
 * 「本物の Git ならこう出る」を先に覚えてほしいので、両方置く。
 */
export function status(state: RepoState, command?: ParsedCommand): CommandResult {
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
   * 止まっている途中は、いちばん先に言う。
   *
   * 本物の Git もここを最初に出す ― 何が起きているか分からないまま
   * 次のコマンドを打つのが、コンフリクトでいちばん怖い瞬間なので。
   */
  const pausing = state.pausing;
  if (pausing) {
    const ways = pausingWays(pausing.kind);
    lines.push('');
    lines.push(`${pausing.from} の取り込みが途中で止まっています（${ways.label}）。`);
    if (pausing.remaining.length > 1) {
      lines.push(`このあと、あと ${pausing.remaining.length - 1} 件を当て直します。`);
    }
    if (pausing.conflicts.length > 0) {
      lines.push('決着のついていないファイル:');
      for (const c of pausing.conflicts) lines.push(`  両方が変更: ${c.path}`);
      lines.push(`直したら git add してください。全部片付くと ${ways.next} で進めます。`);
      lines.push('片側をまるごと選ぶなら git checkout --ours <path> / --theirs <path> です。');
    } else {
      lines.push(`ぶつかっていたファイルは全部片付いています。${ways.next} で先へ進めます。`);
    }
    lines.push(`やめるなら ${ways.abort} です。`);
  }

  if (state.index.length > 0) {
    lines.push('');
    lines.push('コミットされる変更（ステージにあるもの）:');
    for (const f of state.index) {
      lines.push(f.status === 'deleted' ? `  削除: ${f.path}` : `  ${f.path}`);
    }
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

  /*
   * 無視しているファイル。
   *
   * 本物は --ignored を付けないと一覧を出さないが、件数だけは伝える ―
   * 「置いたはずのファイルが status に出てこない」で戸惑うのを避けるため。
   */
  const ignored = state.workingDir.filter((f) => f.status === 'ignored');
  if (ignored.length > 0) {
    lines.push('');
    if (command && hasFlag(command, '--ignored')) {
      lines.push('.gitignore で無視しているファイル:');
      for (const f of ignored) lines.push(`  ${f.path}`);
      lines.push('Git はこれらを見ていません。git add . でも入りません。');
    } else {
      lines.push(
        `.gitignore で無視しているファイルが ${ignored.length} 件あります（git status --ignored で一覧）。`,
      );
    }
  }

  const nothing =
    state.index.length === 0 && state.workingDir.every((f) => f.status === 'ignored');
  if (nothing) {
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
