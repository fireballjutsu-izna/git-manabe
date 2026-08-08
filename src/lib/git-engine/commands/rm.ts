import { isIgnored } from '../ignore';
import { hasFlag, type ParsedCommand } from '../parse';
import { fail, headTree, isTracked, ok, requireRepo } from '../state';
import type { CommandResult, FileState, RepoState, Tree } from '../types';

/**
 * `git rm [--cached] <path>`
 *
 * **追跡をやめる**ためのコマンド。
 *
 *   git rm --cached .env   追跡から外す。ファイルは手元に残る
 *   git rm .env            追跡から外し、ファイルも消す
 *
 * `--cached` のほうが圧倒的によく使われる ―
 * 「うっかりコミットしてしまった秘密のファイル」を止めるときに要るのがこれで、
 * 手元のファイルまで消えては困るから。
 *
 * ここで押さえてほしいのは、**過去のコミットからは消えない**こと。
 * 消えるのは「これ以降」だけで、履歴をさかのぼれば中身はまだそこにある。
 */
export function rm(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const cached = hasFlag(command, '--cached');
  const paths = command.positional;

  if (paths.length === 0) {
    return fail(state, '何を追跡から外すのか書いてください。', '例: git rm --cached .env');
  }

  const unknown = paths.filter((p) => !isTracked(state, p) && state.stage[p] === undefined);
  if (unknown.length > 0) {
    return fail(
      state,
      `${unknown.join(', ')} は Git が追跡していません。`,
      isIgnored(state, unknown[0])
        ? '.gitignore で無視されているので、外す必要はありません。'
        : '追跡しているファイルにだけ使えます。git status で確かめてください。',
    );
  }

  const stage: Tree = { ...state.stage };
  const work: Tree = { ...state.work };
  for (const path of paths) {
    delete stage[path];
    if (!cached) delete work[path];
  }

  /*
   * ステージから消したことも「次のコミットに入れる変更」なので、
   * ステージ側に印を残す。ここを空にしてしまうと、
   * commit したときに何が起きるのか予想できなくなる。
   */
  const index: FileState[] = [
    ...state.index.filter((f) => !paths.includes(f.path)),
    // staged ではなく deleted。「入れる」ではなく「外す」がステージに載っている
    ...paths.map((path) => ({ path, status: 'deleted' as const })),
  ];

  /*
   * --cached なら手元には残る。ここでは untracked として置くだけでよい ―
   * .gitignore に当たるかどうかは、run() の出口が付け直す。
   */
  const workingDir: FileState[] = [
    ...state.workingDir.filter((f) => !paths.includes(f.path)),
    ...(cached ? paths.map((path) => ({ path, status: 'untracked' as const })) : []),
  ];

  const stillInHistory = paths.filter((p) => headTree(state)[p] !== undefined);

  const lines = [
    `${paths.join(', ')} を追跡から外しました。`,
    cached
      ? 'ファイルは手元に残っています。消えたのは「Git が見ている」という関係だけです。'
      : 'ファイルも消しました。手元にも残っていません。',
    'まだコミットしていません。git commit で確定します。',
  ];

  if (stillInHistory.length > 0) {
    lines.push('');
    lines.push('ただし、これで消えるのは**これ以降**だけです。');
    lines.push(
      `過去のコミットには ${stillInHistory.join(', ')} がまだ入っています（git diff HEAD~1 や git log で辿れます）。`,
    );
    lines.push(
      '秘密の値を出してしまったなら、履歴から消す前にまず**その値を作り直して**ください。それがいちばん確実です。',
    );
  }

  return ok({ ...state, stage, work, index, workingDir }, lines, ['workingDir', 'index']);
}
