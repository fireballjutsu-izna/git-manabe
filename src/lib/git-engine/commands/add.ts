import { fail, ok, requireRepo } from '../state';
import type { ParsedCommand } from '../parse';
import type { CommandResult, RepoState } from '../types';

/**
 * `git add <path>` / `git add .`
 *
 * 作業ディレクトリ → ステージ（index）。ここでは中身を運ばず、
 * 「次のコミットに含める」という印だけを移す。
 */
export function add(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const specs = command.positional;
  if (specs.length === 0) {
    return fail(
      state,
      '何を追加するのか書いてください。',
      '例: git add hello.txt / まとめてなら git add .',
    );
  }

  const all = specs.includes('.') || specs.includes('-A') || specs.includes('*');
  const targets = all
    ? state.workingDir
    : state.workingDir.filter((f) => specs.includes(f.path));

  if (targets.length === 0) {
    if (all) {
      return ok(state, ['ステージに移すものがありません。'], []);
    }
    const unknown = specs.filter((s) => !state.workingDir.some((f) => f.path === s));
    return fail(
      state,
      `${unknown.join(', ')} に、まだ変更がありません。`,
      'touch でファイルを作るか、edit で変更してから add してください。',
    );
  }

  const movedPaths = new Set(targets.map((f) => f.path));
  const staged = targets.map((f) => ({ path: f.path, status: 'staged' as const }));

  // 同じパスがすでにステージにあるなら置き換える（重複させない）
  const keptIndex = state.index.filter((f) => !movedPaths.has(f.path));

  const next: RepoState = {
    ...state,
    workingDir: state.workingDir.filter((f) => !movedPaths.has(f.path)),
    index: [...keptIndex, ...staged],
  };

  return ok(
    next,
    [
      `${targets.length} 件をステージに移しました: ${targets.map((f) => f.path).join(', ')}`,
      'まだコミットはされていません。ステージは「次のコミットの下書き」です。',
    ],
    ['workingDir', 'index'],
  );
}
