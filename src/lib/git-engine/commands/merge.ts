import { applyOnto, pauseWith, restore, snapshot } from '../apply';
import { hasFlag, unknownFlags, type ParsedCommand } from '../parse';
import {
  requireClean,
  requireNoPause,
  addCommit,
  currentBranchName,
  fail,
  headCommitId,
  isAncestor,
  loadTree,
  mergeBase,
  nextCommitId,
  ok,
  recordReflog,
  recomputeTracked,
  requireRepo,
  resolveRevision,
  setBranch,
  setHead,
  treeOf,
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
/** このサイトの merge が読むフラグ。ここに無いものは断る。 */
const KNOWN_FLAGS = ['--abort'] as const;

export function merge(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  // --abort だけは、マージの途中でも受ける（というより、そのためにある）
  if (hasFlag(command, '--abort')) return abort(state);

  /*
   * 知らないフラグを黙って落とすと、いちばん危ない誤解を作る。
   * --no-ff を付けたのに fast-forward になり、そのうえで
   * 「マージコミットは作られていません」と説明してしまう。
   */
  const unknown = unknownFlags(command, KNOWN_FLAGS);
  if (unknown.length > 0) {
    return fail(
      state,
      `${unknown.join(', ')} は、このサイトの merge では扱えません。`,
      `使えるのは ${KNOWN_FLAGS.join(' / ')} だけです。本物の Git にあるフラグでも、ここに入っていないものは断ります ― 黙って無視すると、付けたつもりの指定が効かないまま話が進んでしまうので。`,
    );
  }
  /*
   * 止まっているのが merge とは限らない。
   * rebase や cherry-pick の最中に打たれることもあるので、
   * いま何が止まっているかを見て、そのやめ方・続け方を案内する。
   * ここを固定文にしていたので、cherry-pick 中でも「マージの途中です」と言い、
   * そのうえで通らないコマンド（git merge --abort）を勧めていた。
   */
  const pausing = requireNoPause(state);
  if (pausing) return pausing;

  const dirty = requireClean(state, '取り込み');
  if (dirty) return dirty;

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
 * `git merge --abort`
 *
 * 途中で止まっているマージを、なかったことにする。
 * 「詰んだら戻れる」ことを先に知っておくと、コンフリクトは怖くなくなる。
 */
function abort(state: RepoState): CommandResult {
  const pausing = state.pausing;
  if (!pausing) {
    return fail(state, 'いまマージの途中ではありません。');
  }
  if (pausing.kind !== 'merge') {
    return fail(
      state,
      `いま止まっているのは ${pausing.kind} です。`,
      `やめるなら git ${pausing.kind} --abort です。`,
    );
  }
  return ok(
    restore(state, pausing),
    [
      `${pausing.from} の取り込みをやめました。`,
      'マージを始める前の状態に戻っています。コミットは 1 つも増えていません。',
      'ファイルの中身も戻っているので、書き込まれた目印は残っていません。',
    ],
    ['workingDir', 'index'],
  );
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
  next = loadTree(next, treeOf(next, theirs));
  next = { ...next, tracked: recomputeTracked(next, theirs) };
  next = recordReflog(next, 'merge', `${target} を fast-forward`, from, theirs);

  return ok(
    next,
    [
      `fast-forward で ${target} に追いつきました（${theirs}）。`,
      'ひと筋道の上を進んだだけなので、マージコミットは作られていません。',
    ],
    ['repo', 'head', 'workingDir', 'index'],
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

  /*
   * 3 つの版（分岐点・こちら・あちら）を、ファイルの中身ごと 1 つにする。
   *
   * 両側が同じファイルを触っていても、**違う行**ならぶつからない ―
   * パスだけで見ていた頃は、ここで必ず止まってしまっていた。
   */
  const applied = applyOnto(state, base, head, theirs, 'HEAD', target);

  if (applied.conflicts.length > 0) {
    return pauseWith(
      state,
      {
        kind: 'merge',
        from: target,
        theirs,
        base,
        conflicts: applied.conflicts,
        saved: snapshot(state),
        remaining: [],
        done: [],
      },
      applied.tree,
    );
  }

  const id = nextCommitId(state);
  const message = `Merge ${target} into ${branch}`;

  let next = addCommit(state, {
    id,
    parents: [head, theirs],
    message,
    author: 'あなた',
    tree: applied.tree,
  });
  next = setBranch(next, branch, id);
  next = loadTree(next, applied.tree);
  next = { ...next, tracked: recomputeTracked(next, id) };
  next = recordReflog(next, 'merge', message, head, id);

  const merged = next.commits[id].paths;

  return ok(
    next,
    [
      `${target} を ${branch} に取り込みました（${id}）。`,
      base
        ? `分かれたのは ${base} で、そこから伸びた両側をここで 1 つに戻しました。`
        : '共通の祖先が無い履歴どうしを繋ぎました。',
      merged.length > 0
        ? `${merged.length} 件が向こうから入りました: ${merged.join(', ')}`
        : 'こちらに取り込む中身の変化はありませんでした。',
      'このコミットだけが親を 2 つ持ちます。グラフで線が 2 本入ってくるのがそれです。',
    ],
    ['repo', 'head', 'workingDir', 'index'],
  );
}
