import { flagValue, type ParsedCommand } from '../parse';
import {
  addCommit,
  currentBranchName,
  fail,
  headCommitId,
  nextCommitId,
  ok,
  recordReflog,
  requireRepo,
  setBranch,
  setHead,
} from '../state';
import type { CommandResult, RepoState } from '../types';

/** ステージが空のときに、でっち上げる変更のパス。 */
function autoPath(state: RepoState): string {
  let n = Object.keys(state.commits).length + 1;
  let path = `file-${n}.txt`;
  while (state.tracked.includes(path)) {
    n += 1;
    path = `file-${n}.txt`;
  }
  return path;
}

/**
 * `git commit -m <message>`
 *
 * ステージの中身を 1 つのコミットにして、HEAD を前へ進める。
 *
 * HEAD が枝の上にいれば、その枝ごと進む（unborn なら、ここで枝が生まれる）。
 * detached HEAD なら HEAD だけが進み、どの枝も動かない ―
 * 置いていかれたコミットがどうなるかを見せたいので、この違いはそのまま再現する。
 */
export function commit(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const message = flagValue(command, '-m', '--message');
  if (typeof message !== 'string' || !message.trim()) {
    return fail(state, 'コミットメッセージが必要です。', '例: git commit -m "最初のコミット"');
  }

  const notes: string[] = [];

  // ステージが空でも進めるようにする。
  // グラフの形を練習したいだけの人に、毎回 touch と add を強いないための親切。
  let base = state;
  if (base.index.length === 0) {
    const path = autoPath(base);
    base = { ...base, index: [{ path, status: 'staged' }] };
    notes.push(
      `ステージが空だったので、${path} という変更を 1 つ作ってコミットしました（このサイト独自の親切です）。`,
    );
  }

  const parent = headCommitId(base);
  const id = nextCommitId(base);
  const committedPaths = base.index.map((f) => f.path);

  let next = addCommit(base, {
    id,
    parents: parent ? [parent] : [],
    message: message.trim(),
    author: 'あなた',
  });

  // ステージの中身が、これでリポジトリ側のものになる
  next = {
    ...next,
    index: [],
    tracked: [...new Set([...next.tracked, ...committedPaths])],
  };

  const branch = currentBranchName(next);
  if (branch) {
    const wasUnborn = !next.branches.some((b) => b.name === branch);
    next = setBranch(next, branch, id);
    if (wasUnborn) notes.push(`最初のコミットなので、${branch} という枝がここで生まれました。`);
  } else {
    next = setHead(next, { type: 'detached', oid: id });
    notes.push('detached HEAD なので、どの枝も動いていません。HEAD だけが進みました。');
  }

  next = recordReflog(next, 'commit', message.trim(), parent, id);

  return ok(
    next,
    [
      `[${branch ?? 'detached HEAD'} ${id}] ${message.trim()}`,
      `${committedPaths.length} 件を記録しました: ${committedPaths.join(', ')}`,
      ...notes,
    ],
    ['index', 'repo', 'head'],
  );
}
