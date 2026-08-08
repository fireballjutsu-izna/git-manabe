import { defaultContent } from '../content';
import { flagValue, type ParsedCommand } from '../parse';
import {
  addCommit,
  copyTree,
  currentBranchName,
  fail,
  headCommitId,
  nextCommitId,
  ok,
  pausingWays,
  recomputeTracked,
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
 * コミットの tree は、そのときのステージそのもの。
 *
 * HEAD が枝の上にいれば、その枝ごと進む（unborn なら、ここで枝が生まれる）。
 * detached HEAD なら HEAD だけが進み、どの枝も動かない ―
 * 置いていかれたコミットがどうなるかを見せたいので、この違いはそのまま再現する。
 */
export function commit(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const message = flagValue(command, '-m', '--message');

  // マージの途中なら、commit の意味が変わる ― 続きではなく「決着の確定」になる
  if (state.pausing) {
    if (state.pausing.kind !== 'merge') {
      const kind = state.pausing.kind;
      return fail(
        state,
        `${pausingWays(kind).label}の途中です。ここでの続きは git commit ではありません。`,
        `git ${kind} --continue で続けるか、git ${kind} --abort でやめてください。`,
      );
    }
    return finishMerge(state, typeof message === 'string' ? message.trim() : '');
  }

  if (typeof message !== 'string' || !message.trim()) {
    return fail(state, 'コミットメッセージが必要です。', '例: git commit -m "最初のコミット"');
  }

  const notes: string[] = [];

  // ステージが空でも進めるようにする。
  // グラフの形を練習したいだけの人に、毎回 touch と add を強いないための親切。
  let base = state;
  if (base.index.length === 0) {
    const path = autoPath(base);
    base = {
      ...base,
      index: [{ path, status: 'staged' }],
      stage: { ...base.stage, [path]: defaultContent(path) },
      work: { ...base.work, [path]: defaultContent(path) },
    };
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
    // ステージそのものが、このコミットの tree になる
    tree: copyTree(base.stage),
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

  /*
   * 枝を切った直後の 1 コミット目。
   *
   * グラフでは行を分けて描くので枝分かれに見えるが、履歴としてはまだ分かれていない
   * ― 相手はこのコミットの祖先で、1 本の道の途中にいるだけ。
   * 見た目と実態がずれる唯一の場面なので、ここだけは言葉で補う。
   */
  if (parent) {
    const behind = next.branches
      .filter((b) => b.name !== branch && b.target === parent)
      .map((b) => b.name);
    if (behind.length > 0) {
      notes.push(
        `${behind.join(' と ')} は、まだ分かれていません。このコミットの親を指しているだけです。`,
      );
      notes.push(
        `${behind[0]} 側にもコミットすると、そこで初めて「どちらにも相手の持たないコミットがある」状態になります。`,
      );
    }
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

/**
 * 途中で止まっていたマージを、コミットして完了させる。
 *
 * 打つコマンドは普段と同じ `git commit` だが、できるものが違う ―
 * 親を 2 つ持つマージコミットが 1 つできて、止まっていた状態が解ける。
 * コンフリクトの後始末に専用のコマンドが無いのは、これが「ただのコミット」だから。
 */
function finishMerge(state: RepoState, message: string): CommandResult {
  const pausing = state.pausing;
  if (!pausing) return fail(state, 'いまマージの途中ではありません。');

  if (pausing.conflicts.length > 0) {
    return fail(
      state,
      `まだ決着のついていないファイルがあります: ${pausing.conflicts.map((c) => c.path).join(', ')}`,
      '直したファイルを git add してください。やめるなら git merge --abort です。',
    );
  }

  const branch = currentBranchName(state);
  const head = headCommitId(state);
  if (!branch || !head) {
    return fail(state, 'マージの結果を受け取る枝が見つかりません。');
  }

  const id = nextCommitId(state);
  // 本物の Git はここでメッセージを用意してエディタを開く。同じ既定文を使う
  const text = message || `Merge ${pausing.from} into ${branch}`;
  const paths = state.index.map((f) => f.path);

  let next = addCommit(state, {
    id,
    parents: [head, pausing.theirs],
    message: text,
    author: 'あなた',
    tree: copyTree(state.stage),
  });
  next = { ...next, index: [], pausing: null, work: copyTree(state.stage) };
  next = setBranch(next, branch, id);
  next = { ...next, tracked: recomputeTracked(next, id) };
  next = recordReflog(next, 'merge', text, head, id);

  return ok(
    next,
    [
      `[${branch} ${id}] ${text}`,
      `${pausing.from} の取り込みが完了しました。ぶつかった ${paths.length} 件は、ここで 1 つに決まっています。`,
      'このコミットだけが親を 2 つ持ちます。グラフで線が 2 本入ってくるのがそれです。',
    ],
    ['index', 'repo', 'head'],
  );
}
