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

  let next: RepoState = {
    ...state,
    workingDir: state.workingDir.filter((f) => !movedPaths.has(f.path)),
    index: [...keptIndex, ...staged],
  };

  const notes: string[] = [];

  /*
   * マージの途中なら、add には「決着をつけた」という意味が加わる。
   *
   * 本物の Git でも、コンフリクトを直したあとに打つのは git add だけ ―
   * 専用のコマンドは無い。「もう見たので、これで確定」と Git に伝える印が add で、
   * 残りが 0 になった時点でコミットできるようになる。
   */
  const merging = state.merging;
  if (merging) {
    const resolved = targets.filter((f) => f.status === 'conflicted').map((f) => f.path);
    if (resolved.length > 0) {
      const remaining = merging.conflicts.filter((p) => !resolved.includes(p));
      next = { ...next, merging: { ...merging, conflicts: remaining } };
      notes.push(`${resolved.join(', ')} の決着をつけたものとして記録しました。`);
      notes.push(
        remaining.length > 0
          ? `残り ${remaining.length} 件: ${remaining.join(', ')}`
          : 'ぶつかっていたファイルは全部片付きました。git commit でマージを完了できます。',
      );
    }
  }

  return ok(
    next,
    [
      `${targets.length} 件をステージに移しました: ${targets.map((f) => f.path).join(', ')}`,
      ...(notes.length > 0
        ? notes
        : ['まだコミットはされていません。ステージは「次のコミットの下書き」です。']),
    ],
    ['workingDir', 'index'],
  );
}
