import { hasConflictMarkers } from '../content';
import { fail, ok, pausingWays, requireRepo } from '../state';
import type { ParsedCommand } from '../parse';
import type { CommandResult, RepoState, Tree } from '../types';

/**
 * `git add <path>` / `git add .`
 *
 * 作業ディレクトリ → ステージ（index）。中身をそのまま写す。
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

  /*
   * 目印が残ったままの add は止める。
   *
   * 本物の git はこれを通してしまい、<<<<<<< の入ったファイルが
   * そのままコミットされる ― 実務でいちばんよくある事故がこれ。
   * 教材としては通さずに止めて、何が起きかけたかを言う。
   */
  const unresolved = targets.filter((f) => hasConflictMarkers(state.work[f.path]));
  if (unresolved.length > 0) {
    return fail(
      state,
      `${unresolved.map((f) => f.path).join(', ')} に、まだコンフリクトの目印が残っています。`,
      '<<<<<<< と ======= と >>>>>>> の行を消して、残す中身を 1 つに決めてください（edit や git checkout --ours で選べます）。',
    );
  }

  const movedPaths = new Set(targets.map((f) => f.path));
  const staged = targets.map((f) => ({ path: f.path, status: 'staged' as const }));

  // 同じパスがすでにステージにあるなら置き換える（重複させない）
  const keptIndex = state.index.filter((f) => !movedPaths.has(f.path));

  // 中身もステージへ写す。ここが「印だけ移す」から変わったところ
  const stage: Tree = { ...state.stage };
  for (const path of movedPaths) {
    const content = state.work[path];
    if (content) stage[path] = [...content];
    else delete stage[path];
  }

  let next: RepoState = {
    ...state,
    stage,
    workingDir: state.workingDir.filter((f) => !movedPaths.has(f.path)),
    index: [...keptIndex, ...staged],
  };

  const notes: string[] = [];

  /*
   * 止まっている途中なら、add には「決着をつけた」という意味が加わる。
   *
   * 本物の Git でも、コンフリクトを直したあとに打つのは git add だけ ―
   * 専用のコマンドは無い。「もう見たので、これで確定」と Git に伝える印が add で、
   * 残りが 0 になった時点で先へ進めるようになる。
   */
  const pausing = state.pausing;
  if (pausing) {
    const resolved = targets.filter((f) => f.status === 'conflicted').map((f) => f.path);
    if (resolved.length > 0) {
      const remaining = pausing.conflicts.filter((c) => !resolved.includes(c.path));
      next = { ...next, pausing: { ...pausing, conflicts: remaining } };
      const ways = pausingWays(pausing.kind);
      notes.push(`${resolved.join(', ')} の決着をつけたものとして記録しました。`);
      notes.push(
        remaining.length > 0
          ? `残り ${remaining.length} 件: ${remaining.map((c) => c.path).join(', ')}`
          : `ぶつかっていたファイルは全部片付きました。${ways.next} で先へ進めます。`,
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
