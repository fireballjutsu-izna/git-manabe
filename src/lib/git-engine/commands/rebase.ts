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
  recomputeTracked,
  recordReflog,
  requireRepo,
  resolveRevision,
  setBranch,
  setHead,
} from '../state';
import type { Commit, CommandResult, RepoState } from '../types';

/**
 * `git rebase <upstream>`
 *
 * 分かれた枝を、相手の先端の上に**置き直す**。
 *
 * merge との違いはここに尽きる:
 *   merge  … 2 つの流れを合流させる。元のコミットはそのまま残り、合流点が 1 つ増える
 *   rebase … 自分のコミットを 1 つずつ**コピーし直す**。id が変わる ＝ 別のコミットになる
 *
 * コピー元は消えない。ただ、どの枝からも指されなくなるだけ。
 * グラフではそれを薄く描くので、「作り直された」ことが目で分かる。
 */
export function rebase(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const spec = command.positional[0];
  if (!spec) {
    return fail(state, '何の上に置き直すのか書いてください。', '例: git rebase main');
  }

  const head = headCommitId(state);
  if (!head) {
    return fail(state, 'まだコミットが 1 つもないので、置き直すものがありません。');
  }

  const onto = resolveRevision(state, spec);
  if (onto === 'ambiguous') {
    return fail(state, `${spec} で始まるコミットが複数あります。`, 'もう少し長く書いてください。');
  }
  if (!onto) {
    return fail(state, `${spec} という枝もコミットもありません。`);
  }
  if (onto === head) {
    return fail(state, `${spec} は、いまいるコミットそのものです。`);
  }

  // 相手が自分の祖先 ＝ すでにその上にいる。置き直す意味がない
  if (isAncestor(state, onto, head)) {
    return ok(
      state,
      [`すでに ${spec} の上にいます。`, 'グラフは何も変わりません。'],
      [],
    );
  }

  // 自分が相手の祖先 ＝ 分かれていない。前へ滑らせるだけで済む
  if (isAncestor(state, head, onto)) return fastForward(state, spec, onto, head);

  const base = mergeBase(state, head, onto);
  const replay = chainToReplay(state, head, base);

  const merges = replay.filter((c) => c.parents.length > 1);
  const plain = replay.filter((c) => c.parents.length === 1);

  if (plain.length === 0) {
    return fail(
      state,
      '置き直せるコミットがありません。',
      merges.length > 0
        ? 'マージコミットは置き直しの対象外です（本物の git rebase も既定では落とします）。'
        : undefined,
    );
  }

  return replayOnto(state, spec, onto, head, plain, merges.length);
}

/**
 * 置き直す対象を、古い順に並べて返す。
 * 第一親をたどって分岐点まで下り、そこから逆順にする。
 */
function chainToReplay(state: RepoState, head: string, base: string | null): Commit[] {
  const chain: Commit[] = [];
  let cursor: string | undefined = head;
  while (cursor && cursor !== base) {
    const commit: Commit | undefined = state.commits[cursor];
    if (!commit) break;
    chain.push(commit);
    cursor = commit.parents[0];
  }
  return chain.reverse();
}

function fastForward(
  state: RepoState,
  spec: string,
  onto: string,
  from: string,
): CommandResult {
  const branch = currentBranchName(state);
  let next = branch ? setBranch(state, branch, onto) : setHead(state, { type: 'detached', oid: onto });
  next = { ...next, tracked: recomputeTracked(next, onto) };
  next = recordReflog(next, 'rebase', `${spec} へ fast-forward`, from, onto);

  return ok(
    next,
    [
      `${spec} の上へ進みました（${onto}）。`,
      '分かれていなかったので、コピーは起きていません。id はそのままです。',
    ],
    ['repo', 'head'],
  );
}

function replayOnto(
  state: RepoState,
  spec: string,
  onto: string,
  from: string,
  replay: Commit[],
  skippedMerges: number,
): CommandResult {
  let next = state;
  let parent = onto;
  const pairs: { before: string; after: string }[] = [];

  for (const original of replay) {
    const id = nextCommitId(next);
    next = addCommit(next, {
      id,
      parents: [parent],
      message: original.message,
      author: original.author,
      // 中身は同じ。変わるのは「どの上に乗っているか」と、その結果としての id
      paths: [...original.paths],
    });
    pairs.push({ before: original.id, after: id });
    parent = id;
  }

  const branch = currentBranchName(next);
  next = branch
    ? setBranch(next, branch, parent)
    : setHead(next, { type: 'detached', oid: parent });
  next = { ...next, tracked: recomputeTracked(next, parent) };
  next = recordReflog(next, 'rebase', `${spec} の上へ置き直す`, from, parent);

  const lines = [
    `${replay.length} 件を ${spec} の上へ置き直しました。`,
    ...pairs.map((p) => `  ${p.before} → ${p.after}  ${next.commits[p.after].message}`),
    '中身は同じでも、id が変わっています。別のコミットとして作り直されたからです。',
    'コピー元は消えていません。どの枝からも指されなくなっただけで、グラフには薄く残ります。',
  ];
  if (skippedMerges > 0) {
    lines.push(
      `マージコミット ${skippedMerges} 件は置き直していません（本物の git rebase も既定では落とします）。`,
    );
  }

  return ok(next, lines, ['repo', 'head']);
}
