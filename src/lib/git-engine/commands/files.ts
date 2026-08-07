import { fail, isTracked, ok, pathExists, requireRepo, setWorkingDir } from '../state';
import type { ParsedCommand } from '../parse';
import type { CommandResult, RepoState } from '../types';

/**
 * `touch <path>` — Git のコマンドではない。
 *
 * 作業ディレクトリに、まだ Git が知らないファイルを 1 つ作る。
 * 本物の Git を触るときはエディタでファイルを作る操作にあたる。
 */
export function touch(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const path = command.positional[0];
  if (!path) {
    return fail(state, 'ファイル名を書いてください。', '例: touch hello.txt');
  }
  if (pathExists(state, path)) {
    return fail(
      state,
      `${path} はもうあります。`,
      isTracked(state, path)
        ? `変更したことにするなら edit ${path} を使ってください。`
        : '別の名前にしてください。',
    );
  }

  return ok(
    setWorkingDir(state, [...state.workingDir, { path, status: 'untracked' }]),
    [`${path} を作りました。`, 'Git はまだこのファイルを知りません（untracked）。'],
    ['workingDir'],
  );
}

/**
 * `edit <path>` — Git のコマンドではない。
 *
 * コミット済みのファイルを変更したことにする。
 * untracked と modified の違いを手で作れるようにするために置いている。
 */
export function edit(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const path = command.positional[0];
  if (!path) {
    return fail(state, 'ファイル名を書いてください。', '例: edit hello.txt');
  }
  if (!isTracked(state, path)) {
    return fail(
      state,
      `${path} は、まだ一度もコミットされていません。`,
      `新しく作るなら touch ${path} を使ってください。`,
    );
  }
  if (state.workingDir.some((f) => f.path === path)) {
    return ok(state, [`${path} は、すでに変更済みです。`], []);
  }

  return ok(
    setWorkingDir(state, [...state.workingDir, { path, status: 'modified' }]),
    [`${path} を変更しました。`, 'コミット済みのファイルへの変更なので modified です。'],
    ['workingDir'],
  );
}
