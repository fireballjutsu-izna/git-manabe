import { copyTree } from '../content';
import { flagValue, type ParsedCommand } from '../parse';
import { fail, headCommitId, ok, requireRepo, treeOf } from '../state';
import type { CommandResult, FileState, RepoState, StashEntry, Tree } from '../types';

/**
 * `git stash` / `push` / `pop` / `apply` / `list` / `drop`
 *
 * コミットを 1 つも作らずに、作業中の変更を脇へ置く。
 *
 * このサイトで唯一、**グラフが一切変わらない**コマンド。
 * 動くのは 3 領域だけで、履歴には何の跡も残らない。
 * 「まだコミットしたくないが、いまの手元は片付けたい」ときのための道具。
 */
export function stash(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const sub = command.positional[0] ?? 'push';
  switch (sub) {
    case 'push':
    case 'save':
      return push(state, command);
    case 'pop':
      return restore(state, true);
    case 'apply':
      return restore(state, false);
    case 'list':
      return list(state);
    case 'drop':
      return drop(state);
    default:
      return fail(
        state,
        `git stash ${sub} は扱えません。`,
        '使えるのは push / pop / apply / list / drop です。',
      );
  }
}

function push(state: RepoState, command: ParsedCommand): CommandResult {
  if (state.index.length === 0 && state.workingDir.length === 0) {
    return ok(state, ['退避するものがありません。作業ディレクトリもステージも空です。'], []);
  }

  const label = flagValue(command, '-m', '--message');
  const base = headCommitId(state);
  const seq = state.seq + 1;

  const entry: StashEntry = {
    id: seq,
    message:
      typeof label === 'string' && label.trim()
        ? label.trim()
        : `WIP on ${base ?? '(コミットなし)'}`,
    index: state.index,
    workingDir: state.workingDir,
    work: copyTree(state.work),
    stage: copyTree(state.stage),
    base,
  };

  const total = state.index.length + state.workingDir.length;
  // 退避したあとは「コミットそのままの状態」。中身も HEAD の tree に戻す
  const clean = copyTree(treeOf(state, base));

  return ok(
    {
      ...state,
      seq,
      stash: [...state.stash, entry],
      index: [],
      workingDir: [],
      work: clean,
      stage: clean,
    },
    [
      `${total} 件を退避しました: ${entry.message}`,
      '作業ディレクトリもステージも空になりました。グラフは変わりません。',
      '戻すには git stash pop を実行してください。',
    ],
    ['workingDir', 'index'],
  );
}

function restore(state: RepoState, remove: boolean): CommandResult {
  const entry = state.stash[state.stash.length - 1];
  if (!entry) {
    return fail(state, '退避したものがありません。', '一覧は git stash list で見られます。');
  }

  // いま手元にあるものを優先し、退避していたぶんを足す。
  // 同じパスが両方にあるときは、手元の状態をそのまま残す。
  const workingDir = mergeFiles(state.workingDir, entry.workingDir);
  const index = mergeFiles(state.index, entry.index);
  // いま手元で変えているパスは、退避のぶんで上書きしない
  const dirtyNow = new Set([...state.workingDir, ...state.index].map((f) => f.path));
  const work = mergeTree(state.work, entry.work, entry.workingDir, dirtyNow);
  const stage = mergeTree(state.stage, entry.stage, entry.index, dirtyNow);

  const lines = [
    `${entry.index.length + entry.workingDir.length} 件を戻しました: ${entry.message}`,
  ];
  if (remove) lines.push('退避の一覧からは取り除きました。');
  else lines.push('退避の一覧には残したままです（apply なので）。');
  if (entry.base && entry.base !== headCommitId(state)) {
    lines.push(`退避したときとは別のコミットの上にいます（当時は ${entry.base}）。`);
  }

  return ok(
    {
      ...state,
      index,
      workingDir,
      work,
      stage,
      stash: remove ? state.stash.slice(0, -1) : state.stash,
    },
    lines,
    ['workingDir', 'index'],
  );
}

/**
 * 退避していた中身を戻す。
 *
 * 退避したあとに変えたファイルは、手元のものをそのまま残す ―
 * 上書きすると、pop したとたんに直近の作業が消えることになる。
 */
function mergeTree(
  current: Tree,
  restored: Tree,
  entries: FileState[],
  dirtyNow: Set<string>,
): Tree {
  const out = copyTree(current);
  for (const f of entries) {
    if (dirtyNow.has(f.path)) continue;
    if (restored[f.path] !== undefined) out[f.path] = [...restored[f.path]];
  }
  return out;
}

function mergeFiles(current: FileState[], restored: FileState[]): FileState[] {
  const byPath = new Map<string, FileState>();
  for (const f of restored) byPath.set(f.path, f);
  for (const f of current) byPath.set(f.path, f);
  return [...byPath.values()];
}

function list(state: RepoState): CommandResult {
  if (state.stash.length === 0) {
    return ok(state, ['退避したものはありません。'], []);
  }
  // stash@{0} が最新。配列は古い順なので、表示は逆から
  const lines = [...state.stash].reverse().map((entry, i) => {
    const count = entry.index.length + entry.workingDir.length;
    return `stash@{${i}}: ${entry.message}（${count} 件）`;
  });
  return ok(state, lines, []);
}

function drop(state: RepoState): CommandResult {
  const entry = state.stash[state.stash.length - 1];
  if (!entry) return fail(state, '退避したものがありません。');
  return ok(
    { ...state, stash: state.stash.slice(0, -1) },
    [`stash@{0}（${entry.message}）を捨てました。中身は戻せません。`],
    [],
  );
}
