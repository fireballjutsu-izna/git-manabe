import type { ParsedCommand } from '../parse';
import {
  addCommit,
  currentBranchName,
  fail,
  headCommitId,
  isAncestor,
  mergeBase,
  nextCommitId,
  ok,
  recordReflog,
  recomputeTracked,
  requireRepo,
  resolveRevision,
  setBranch,
  setHead,
} from '../state';
import type { CommandResult, RepoState } from '../types';

/**
 * `git merge <branch>`
 *
 * 3 つの結末があり、どれになるかは「2 つのコミットの位置関係」だけで決まる。
 * この分岐がグラフの上でそのまま見えることが、この章のねらい。
 *
 *   相手が自分の祖先        → もう取り込み済み。何も起きない
 *   自分が相手の祖先        → fast-forward。**コミットは増えず**、名前が前へ滑るだけ
 *   どちらでもない（分岐）  → 3-way。親を 2 つ持つマージコミットが生まれる
 */
export function merge(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const target = command.positional[0];
  if (!target) {
    return fail(state, '何を取り込むのか書いてください。', '例: git merge feature');
  }

  const head = headCommitId(state);
  if (!head) {
    return fail(
      state,
      'まだコミットが 1 つもないので、マージできません。',
      '先に git commit を実行してください。',
    );
  }

  const theirs = resolveRevision(state, target);
  if (theirs === 'ambiguous') {
    return fail(state, `${target} で始まるコミットが複数あります。`, 'もう少し長く書いてください。');
  }
  if (!theirs) {
    return fail(state, `${target} という枝もコミットもありません。`, '枝の一覧は git branch で見られます。');
  }
  if (theirs === head) {
    return fail(state, `${target} は、いまいるコミットそのものです。`);
  }

  // 相手がすでに自分の祖先 ＝ 取り込むものが無い
  if (isAncestor(state, theirs, head)) {
    return ok(
      state,
      [`${target} は、すでに取り込まれています。`, 'グラフは何も変わりません。'],
      [],
    );
  }

  if (isAncestor(state, head, theirs)) return fastForward(state, target, theirs);
  return threeWay(state, target, head, theirs);
}

/**
 * 自分が相手の祖先のとき。
 * 分かれていないので、新しいコミットを作る意味がない ― 名前を前へ滑らせるだけ。
 * 「マージしたのにマージコミットができない」のはここ。
 */
function fastForward(state: RepoState, target: string, theirs: string): CommandResult {
  const from = headCommitId(state);
  const branch = currentBranchName(state);

  let next = branch ? setBranch(state, branch, theirs) : setHead(state, { type: 'detached', oid: theirs });
  next = { ...next, tracked: recomputeTracked(next, theirs) };
  next = recordReflog(next, 'merge', `${target} を fast-forward`, from, theirs);

  return ok(
    next,
    [
      `fast-forward で ${target} に追いつきました（${theirs}）。`,
      'ひと筋道の上を進んだだけなので、マージコミットは作られていません。',
    ],
    ['repo', 'head'],
  );
}

/**
 * 分かれているとき。
 * 分岐点（マージベース）から両側が伸びているので、両方を親に持つコミットを 1 つ作る。
 */
function threeWay(
  state: RepoState,
  target: string,
  head: string,
  theirs: string,
): CommandResult {
  const branch = currentBranchName(state);
  if (!branch) {
    return fail(
      state,
      'detached HEAD ではマージできません。',
      'マージの結果を受け取る枝が要ります。git switch <枝の名前> で戻ってください。',
    );
  }

  const base = mergeBase(state, head, theirs);
  const id = nextCommitId(state);
  const message = `Merge ${target} into ${branch}`;

  let next = addCommit(state, {
    id,
    parents: [head, theirs],
    message,
    author: 'あなた',
    // マージそのものは新しい変更を持ち込まない。
    // 中身は両側のコミットが既に記録している。
    paths: [],
  });
  next = setBranch(next, branch, id);
  next = { ...next, tracked: recomputeTracked(next, id) };
  next = recordReflog(next, 'merge', message, head, id);

  return ok(
    next,
    [
      `${target} を ${branch} に取り込みました（${id}）。`,
      base
        ? `分かれたのは ${base} で、そこから伸びた両側をここで 1 つに戻しました。`
        : '共通の祖先が無い履歴どうしを繋ぎました。',
      'このコミットだけが親を 2 つ持ちます。グラフで線が 2 本入ってくるのがそれです。',
    ],
    ['repo', 'head'],
  );
}
