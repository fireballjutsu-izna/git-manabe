import { applyOnto, pauseWith, restore, snapshot } from '../apply';
import { replayTodo } from '../interactive';
import { hasFlag, type ParsedCommand } from '../parse';
import {
  joinJa,
  requireClean,
  addCommit,
  currentBranchName,
  fail,
  headCommitId,
  isAncestor,
  loadTree,
  mergeBase,
  nextCommitId,
  ok,
  pausingWays,
  recomputeTracked,
  recordReflog,
  requireRepo,
  resolveRevision,
  setBranch,
  setHead,
  treeOf,
} from '../state';
import type { Commit, CommandResult, Pausing, RepoState, TodoItem } from '../types';

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
 *
 * そして rebase は**途中で止まる**。1 つずつ当て直すので、
 * ぶつかるたびに手が止まり、そのつど --continue で進める ―
 * 実務でいちばん痛いのがこれで、merge の 1 回で済む止まり方とは体感が違う。
 */
export function rebase(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  if (hasFlag(command, '--abort')) return abort(state);
  if (hasFlag(command, '--continue')) return proceed(state);

  if (state.todo) {
    return fail(
      state,
      'いま書き換えの計画を立てているところです。',
      'todo run で実行するか、git rebase --abort でやめてください。',
    );
  }

  if (state.pausing) {
    return fail(
      state,
      joinJa(pausingWays(state.pausing.kind).label, 'の途中です。もう 1 つ始めることはできません。'),
      'git rebase --continue で続けるか、git rebase --abort でやめてください。',
    );
  }

  /*
   * 本物の Git は、片付いていない変更があると rebase を必ず断る。
   * 1 つずつ当て直すので、途中で手元の変更と衝突すると収拾がつかなくなるため。
   * 「rebase の前に stash」はここから来ている。
   */
  const dirty = requireClean(state, '置き直し');
  if (dirty) return dirty;

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

  /*
   * -i は、ここで**止まる**。
   *
   * 本物もエディタを開くだけで、履歴にはまだ何も起きていない。
   * 「計画を立ててから、まとめて実行する」のが -i の形なので、
   * その 2 段構えをそのまま state に持たせる。
   *
   * 分かれていなくても開く ― 実務でいちばん多い使い方が
   * 「push する前に、自分のコミットだけを整える」だから。
   * git rebase -i HEAD~3 のような呼び方も、これで通る。
   */
  if (hasFlag(command, '-i', '--interactive')) {
    return plan(state, spec, onto, head);
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
  const chain = chainToReplay(state, head, base);

  const merges = chain.filter((c) => c.parents.length > 1);
  const plain = chain.filter((c) => c.parents.length === 1);

  if (plain.length === 0) {
    return fail(
      state,
      '置き直せるコミットがありません。',
      merges.length > 0
        ? 'マージコミットは置き直しの対象外です（本物の git rebase も既定では落とします）。'
        : undefined,
    );
  }

  const saved = snapshot(state);

  // 置き直しは「積む先へいったん移ってから、1 つずつ当てる」
  const moved = moveTo(state, onto);
  return replay(moved, spec, plain.map((c) => c.id), [], saved, head, merges.length);
}

/**
 * `git rebase -i` の計画を開く。
 *
 * 分岐点から HEAD までを todo に並べるだけ。まだ何も置き直さない。
 */
function plan(state: RepoState, spec: string, onto: string, head: string): CommandResult {
  /*
   * 積む先（onto）と、書き換える範囲の起点（base）は別物。
   * 分かれているときは onto が相手の先端、base はその分岐点になる。
   * 分かれていなければ両方とも同じところを指す。
   */
  const base = mergeBase(state, head, onto);
  const chain = chainToReplay(state, head, base).filter((c) => c.parents.length === 1);

  if (chain.length === 0) {
    return fail(
      state,
      `${spec} との間に、書き換えられるコミットがありません。`,
      'マージコミットは対象外です（本物の git rebase も既定では落とします）。',
    );
  }

  const items: TodoItem[] = chain.map((c) => ({
    id: c.id,
    action: 'pick',
    message: c.message,
    original: c.message,
  }));

  return ok(
    { ...state, todo: { onto, upstream: spec, items, saved: snapshot(state) } },
    [
      `${chain.length} 件をどう置き直すか、計画を立てます。まだ履歴は何も変わっていません。`,
      '',
      '計画:',
      ...items.map((item, i) => `  ${i + 1}  pick   ${item.id}  ${item.message}`),
      '',
      '上のパネルのボタンか、todo コマンドで組み立てます。',
      '  todo squash 2      2 行目を 1 つ上にまとめる',
      '  todo drop 3        3 行目を落とす',
      '  todo reword 1 <文> メッセージを書き換える',
      '  todo up 2 / down 1 並べ替える',
      '',
      '決まったら todo run で実行します（本物ならエディタを閉じるところです）。',
      'やめるなら git rebase --abort です。',
    ],
    ['repo'],
  );
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
  let next = moveTo(state, onto);
  next = loadTree(next, treeOf(next, onto));
  next = { ...next, tracked: recomputeTracked(next, onto) };
  next = recordReflog(next, 'rebase', `${spec} へ fast-forward`, from, onto);

  return ok(
    next,
    [
      `${spec} の上へ進みました（${onto}）。`,
      '分かれていなかったので、コピーは起きていません。id はそのままです。',
    ],
    ['repo', 'head', 'workingDir', 'index'],
  );
}

/** 枝の上なら枝ごと、detached なら HEAD だけを動かす。 */
function moveTo(state: RepoState, id: string): RepoState {
  const branch = currentBranchName(state);
  return branch ? setBranch(state, branch, id) : setHead(state, { type: 'detached', oid: id });
}

/** 残りを 1 つずつ当て直す。ぶつかったらそこで止まる。 */
function replay(
  state: RepoState,
  spec: string,
  remaining: string[],
  done: { before: string; after: string }[],
  saved: Pausing['saved'],
  from: string,
  skippedMerges: number,
): CommandResult {
  let next = state;
  let parent = headCommitId(next) as string;
  const pairs = [...done];

  for (let i = 0; i < remaining.length; i += 1) {
    const target = remaining[i];
    const original = next.commits[target];

    const applied = applyOnto(
      next,
      original.parents[0] ?? null,
      parent,
      target,
      '積む先',
      original.message,
    );

    if (applied.conflicts.length > 0) {
      return pauseWith(
        next,
        {
          kind: 'rebase',
          from: original.message,
          theirs: target,
          base: original.parents[0] ?? null,
          conflicts: applied.conflicts,
          saved,
          remaining: remaining.slice(i),
          done: pairs,
        },
        applied.tree,
      );
    }

    const id = nextCommitId(next);
    next = addCommit(next, {
      id,
      parents: [parent],
      message: original.message,
      author: original.author,
      tree: applied.tree,
    });
    pairs.push({ before: target, after: id });
    parent = id;
    next = moveTo(next, parent);
  }

  next = loadTree(next, next.commits[parent].tree);
  next = { ...next, tracked: recomputeTracked(next, parent), pausing: null };
  next = recordReflog(next, 'rebase', `${spec} の上へ置き直す`, from, parent);

  const lines = [
    `${pairs.length} 件を ${spec} の上へ置き直しました。`,
    ...pairs.map((p) => `  ${p.before} → ${p.after}  ${next.commits[p.after].message}`),
    '中身は同じでも、id が変わっています。別のコミットとして作り直されたからです。',
    'コピー元は消えていません。どの枝からも指されなくなっただけで、グラフには薄く残ります。',
  ];
  if (skippedMerges > 0) {
    lines.push(
      `マージコミット ${skippedMerges} 件は置き直していません（本物の git rebase も既定では落とします）。`,
    );
  }

  return ok(next, lines, ['repo', 'head', 'workingDir', 'index']);
}

/**
 * `git rebase --continue`
 *
 * 止まっていた 1 件を、いまのステージの中身でコミットしてから、残りを続ける。
 * 何件も残っていれば、また次でぶつかって止まる ―
 * これが「rebase は 1 回で終わらないことがある」の正体。
 */
function proceed(state: RepoState): CommandResult {
  const pausing = state.pausing;
  if (!pausing) return fail(state, 'いま rebase の途中ではありません。');
  if (pausing.kind !== 'rebase') {
    return fail(
      state,
      joinJa('いま止まっているのは', pausingWays(pausing.kind).label, 'です。'),
      pausing.kind === 'merge'
        ? '続けるなら git commit です。'
        : `続けるなら git ${pausing.kind} --continue です。`,
    );
  }
  if (pausing.conflicts.length > 0) {
    return fail(
      state,
      `まだ決着のついていないファイルがあります: ${pausing.conflicts.map((c) => c.path).join(', ')}`,
      '直したファイルを git add してください。やめるなら git rebase --abort です。',
    );
  }

  /*
   * 対話的 rebase の途中なら、続きも計画どおりに進める。
   * 決着をつけた中身（ステージ）が、そのまままとめ途中の塊になる。
   */
  if (pausing.todo) {
    const [applied, ...rest] = pausing.todo.items;
    return replayTodo(
      { ...state, pausing: null },
      {
        items: rest,
        messages: pausing.todo.messages,
        done: pausing.done,
        from: pausing.saved.branchTarget ?? (headCommitId(state) as string),
        upstream: '元の場所',
        saved: pausing.saved,
        resumedTree: state.stage,
        leadId: pausing.todo.leadId,
        justApplied: applied,
      },
    );
  }

  const target = pausing.remaining[0];
  const original = state.commits[target];
  const parent = headCommitId(state) as string;
  const id = nextCommitId(state);

  let next = addCommit(state, {
    id,
    parents: [parent],
    message: original.message,
    author: original.author,
    tree: state.stage,
  });
  next = moveTo(next, id);

  const done = [...pausing.done, { before: target, after: id }];
  const rest = pausing.remaining.slice(1);

  const resumed = replay(
    { ...next, pausing: null },
    '元の場所',
    rest,
    done,
    pausing.saved,
    pausing.saved.branchTarget ?? parent,
    0,
  );

  return {
    ...resumed,
    log: [
      `${target} の決着を ${id} として記録しました。`,
      ...(rest.length > 0 ? [`残り ${rest.length} 件を続けます。`] : []),
      ...resumed.log,
    ],
  };
}

/**
 * `git rebase --abort`
 *
 * 置き直しをまるごとやめて、始める前に戻す。
 * 途中まで作ったコピーは、どの枝からも指されない場所に残る ―
 * 「やめても壊れない」ことが分かると、rebase は怖くなくなる。
 */
function abort(state: RepoState): CommandResult {
  // 計画を立てている段階でやめる。まだ何も起きていないので、消すだけで戻る
  if (state.todo) {
    return ok(
      { ...state, todo: null },
      [
        '書き換えをやめました。',
        '計画を立てていただけなので、履歴は最初から何も変わっていません。',
      ],
      ['repo'],
    );
  }

  const pausing = state.pausing;
  if (!pausing) return fail(state, 'いま rebase の途中ではありません。');
  if (pausing.kind !== 'rebase') {
    return fail(
      state,
      joinJa('いま止まっているのは', pausingWays(pausing.kind).label, 'です。'),
      pausing.kind === 'merge'
        ? 'やめるなら git merge --abort です。'
        : `やめるなら git ${pausing.kind} --abort です。`,
    );
  }

  return ok(
    restore(state, pausing),
    [
      'rebase をやめました。枝は置き直す前の場所に戻っています。',
      pausing.done.length > 0
        ? `途中まで作った ${pausing.done.length} 件のコピーは、どの枝からも辿れない場所に残ります（消えてはいません）。`
        : 'コミットは 1 つも増えていません。',
      'ファイルの中身も戻っているので、書き込まれた目印は残っていません。',
    ],
    ['repo', 'head', 'workingDir', 'index'],
  );
}
