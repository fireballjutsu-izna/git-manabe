import { applyOnto, applyReverse, pauseWith, restore, snapshot } from '../apply';
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
  nextCommitId,
  ok,
  pausingWays,
  recomputeTracked,
  recordReflog,
  requireRepo,
  resolveRevision,
  setBranch,
  setHead,
} from '../state';
import type { CommandResult, Pausing, RepoState } from '../types';

/**
 * `git cherry-pick <commit>...`
 *
 * 指定したコミットを、いまいる場所の上にコピーする。
 *
 * rebase が「枝ごと引っ越す」のに対し、これは**1 つだけ摘んでくる**。
 * どちらもコピーなので、やはり id は変わる。元は元の場所に残ったまま。
 *
 * 中身を持つようになったので、摘んだ先とぶつかれば**途中で止まる**。
 * 止まったら --continue か --abort の 2 択で、merge とまったく同じ形。
 */
export function cherryPick(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  if (hasFlag(command, '--abort')) return abort(state);
  if (hasFlag(command, '--continue')) return proceed(state);

  if (state.pausing) {
    return fail(
      state,
      joinJa(pausingWays(state.pausing.kind).label, 'の途中です。もう 1 つ始めることはできません。'),
      'git cherry-pick --continue で続けるか、git cherry-pick --abort でやめてください。',
    );
  }

  const dirty = requireClean(state, '摘み取り');
  if (dirty) return dirty;

  const specs = command.positional;
  if (specs.length === 0) {
    return fail(state, '何を持ってくるのか書いてください。', '例: git cherry-pick a1b2c3d');
  }

  const head = headCommitId(state);
  if (!head) {
    return fail(state, 'まだコミットが 1 つもないので、その上に積めません。');
  }

  // 先に全部を解決してから積む。途中で失敗して半端に積まれるのを防ぐ
  const targets: string[] = [];
  for (const spec of specs) {
    const id = resolveRevision(state, spec);
    if (id === 'ambiguous') {
      return fail(state, `${spec} で始まるコミットが複数あります。`, 'もう少し長く書いてください。');
    }
    if (!id) return fail(state, `${spec} というコミットがありません。`);
    if (state.commits[id].parents.length > 1) {
      return fail(
        state,
        `${spec} はマージコミットです。`,
        'どちらの親から見た変更を持ってくるのかが決まらないので、ここでは扱えません。',
      );
    }
    targets.push(id);
  }

  return replay(state, targets, [], snapshot(state), head);
}

/**
 * 残りを 1 つずつ当てていく。
 *
 * cherry-pick も rebase の --continue も、ここへ戻ってくる ―
 * 「残りを当てる」以外にやることが無いので、続きの入口は 1 つで足りる。
 */
function replay(
  state: RepoState,
  remaining: string[],
  done: { before: string; after: string }[],
  saved: Pausing['saved'],
  head: string,
): CommandResult {
  let next = state;
  let parent = headCommitId(next) as string;
  const pairs = [...done];
  const notes: string[] = [];

  for (let i = 0; i < remaining.length; i += 1) {
    const target = remaining[i];
    const original = next.commits[target];

    if (isAncestor(next, target, parent)) {
      notes.push(`${target}（${original.message}）は、すでにここから辿れます。それでも複製します。`);
    }

    // 摘む ＝「元の親 → 元」の変更を、いまいる場所に当てる
    const applied = applyOnto(
      next,
      original.parents[0] ?? null,
      parent,
      target,
      'HEAD',
      original.message,
    );

    if (applied.conflicts.length > 0) {
      return pauseWith(
        next,
        {
          kind: 'cherry-pick',
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
  next = recordReflog(next, 'cherry-pick', `${pairs.length} 件を摘む`, head, parent);

  return ok(
    next,
    [
      `${pairs.length} 件をここに持ってきました。`,
      ...pairs.map((p) => `  ${p.before} → ${p.after}  ${next.commits[p.after].message}`),
      '元のコミットはそのままです。同じ中身が 2 か所にある状態になりました。',
      ...notes,
    ],
    ['repo', 'head', 'workingDir', 'index'],
  );
}

/** 枝の上なら枝ごと、detached なら HEAD だけを動かす。 */
function moveTo(state: RepoState, id: string): RepoState {
  const branch = currentBranchName(state);
  return branch ? setBranch(state, branch, id) : setHead(state, { type: 'detached', oid: id });
}

/**
 * `git cherry-pick --continue`
 *
 * 止まっていたぶんを、いまのステージの中身でコミットしてから、残りを続ける。
 * merge が `git commit` で完了するのに対し、こちらは専用のコマンドになる ―
 * 「まだ続きがある」ことを Git 側が覚えているからで、この違いは本物と同じ。
 */
function proceed(state: RepoState): CommandResult {
  const pausing = state.pausing;
  if (!pausing) return fail(state, 'いま cherry-pick の途中ではありません。');
  if (pausing.kind !== 'cherry-pick') {
    return fail(
      state,
      joinJa('いま止まっているのは', pausingWays(pausing.kind).label, 'です。'),
      `続けるなら git ${pausing.kind} --continue です。`,
    );
  }
  if (pausing.conflicts.length > 0) {
    return fail(
      state,
      `まだ決着のついていないファイルがあります: ${pausing.conflicts.map((c) => c.path).join(', ')}`,
      '直したファイルを git add してください。やめるなら git cherry-pick --abort です。',
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
    // 決着をつけた結果 ＝ いまのステージが、そのままこのコミットになる
    tree: state.stage,
  });
  next = moveTo(next, id);

  const done = [...pausing.done, { before: target, after: id }];
  const rest = pausing.remaining.slice(1);

  const resumed = replay(
    { ...next, pausing: null },
    rest,
    done,
    pausing.saved,
    pausing.saved.branchTarget ?? parent,
  );

  return {
    ...resumed,
    log: [`${target} の決着を ${id} として記録しました。`, ...resumed.log],
  };
}

/** `git cherry-pick --abort` ― 始める前に戻す。積んだぶんも取り消す。 */
function abort(state: RepoState): CommandResult {
  const pausing = state.pausing;
  if (!pausing) return fail(state, 'いま cherry-pick の途中ではありません。');
  if (pausing.kind !== 'cherry-pick') {
    return fail(
      state,
      joinJa('いま止まっているのは', pausingWays(pausing.kind).label, 'です。'),
      `やめるなら git ${pausing.kind} --abort です。`,
    );
  }

  return ok(
    restore(state, pausing),
    [
      'cherry-pick をやめました。',
      pausing.done.length > 0
        ? `途中まで積んでいた ${pausing.done.length} 件も、辿れない場所へ戻しました。`
        : '始める前の状態に戻っています。',
      'ファイルの中身も戻っているので、書き込まれた目印は残っていません。',
    ],
    ['repo', 'head', 'workingDir', 'index'],
  );
}

/**
 * `git revert <commit>`
 *
 * 打ち消すためのコミットを、**新しく積む**。
 *
 * reset との違いがこの章の要点:
 *   reset  … 枝を後ろへ動かす。履歴そのものを書き換える
 *   revert … 履歴は 1 つも消さず、逆向きの変更を前に足す
 * 他の人と共有した履歴を直すときは、後者しか使えない。
 */
export function revert(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const dirty = requireClean(state, '打ち消し');
  if (dirty) return dirty;

  const spec = command.positional[0];
  if (!spec) {
    return fail(state, '何を打ち消すのか書いてください。', '例: git revert HEAD');
  }

  const head = headCommitId(state);
  if (!head) {
    return fail(state, 'まだコミットが 1 つもないので、打ち消すものがありません。');
  }

  const target = resolveRevision(state, spec);
  if (target === 'ambiguous') {
    return fail(state, `${spec} で始まるコミットが複数あります。`, 'もう少し長く書いてください。');
  }
  if (!target) return fail(state, `${spec} というコミットがありません。`);

  const original = state.commits[target];
  if (original.parents.length > 1) {
    return fail(
      state,
      `${spec} はマージコミットです。`,
      'どちらの親を残すのかを -m で選ぶ必要がありますが、ここでは扱えません。',
    );
  }

  const id = nextCommitId(state);
  const message = `Revert "${original.message}"`;

  // 打ち消す ＝「元 → 元の親」の変更を当てる。向きが逆なだけで、摘むのと同じ操作
  const applied = applyReverse(state, target, head, 'HEAD', message);
  if (applied.conflicts.length > 0) {
    return fail(
      state,
      `${target}（${original.message}）を打ち消せません。`,
      `そのあと ${applied.conflicts.map((c) => c.path).join(', ')} が変わっていて、どこへ戻せばよいのか決められません。`,
    );
  }

  let next = addCommit(state, {
    id,
    parents: [head],
    message,
    author: 'あなた',
    tree: applied.tree,
  });
  next = moveTo(next, id);
  next = loadTree(next, applied.tree);
  next = { ...next, tracked: recomputeTracked(next, id) };
  next = recordReflog(next, 'revert', message, head, id);

  const branch = currentBranchName(next);

  return ok(
    next,
    [
      `[${branch ?? 'detached HEAD'} ${id}] ${message}`,
      `${target}（${original.message}）を打ち消すコミットを、前に足しました。`,
      '履歴は 1 つも消えていません。reset のように枝を後ろへ動かしてはいないので、',
      '共有済みの履歴でも安全に使えます。',
    ],
    ['repo', 'head', 'workingDir', 'index'],
  );
}
