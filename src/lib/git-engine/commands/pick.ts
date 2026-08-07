import type { ParsedCommand } from '../parse';
import {
  addCommit,
  currentBranchName,
  fail,
  headCommitId,
  isAncestor,
  nextCommitId,
  ok,
  recomputeTracked,
  recordReflog,
  requireRepo,
  resolveRevision,
  setBranch,
  setHead,
} from '../state';
import type { CommandResult, RepoState } from '../types';

/**
 * `git cherry-pick <commit>...`
 *
 * 指定したコミットを、いまいる場所の上にコピーする。
 *
 * rebase が「枝ごと引っ越す」のに対し、これは**1 つだけ摘んでくる**。
 * どちらもコピーなので、やはり id は変わる。元は元の場所に残ったまま。
 */
export function cherryPick(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

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

  let next = state;
  let parent = head;
  const notes: string[] = [];
  const pairs: { before: string; after: string }[] = [];

  for (const target of targets) {
    const original = next.commits[target];
    if (isAncestor(next, target, parent)) {
      notes.push(`${target}（${original.message}）は、すでにここから辿れます。それでも複製します。`);
    }
    const id = nextCommitId(next);
    next = addCommit(next, {
      id,
      parents: [parent],
      message: original.message,
      author: original.author,
      paths: [...original.paths],
    });
    pairs.push({ before: target, after: id });
    parent = id;
  }

  const branch = currentBranchName(next);
  next = branch
    ? setBranch(next, branch, parent)
    : setHead(next, { type: 'detached', oid: parent });
  next = { ...next, tracked: recomputeTracked(next, parent) };
  next = recordReflog(next, 'cherry-pick', `${targets.length} 件を摘む`, head, parent);

  return ok(
    next,
    [
      `${targets.length} 件をここに持ってきました。`,
      ...pairs.map((p) => `  ${p.before} → ${p.after}  ${next.commits[p.after].message}`),
      '元のコミットはそのままです。同じ中身が 2 か所にある状態になりました。',
      ...notes,
    ],
    ['repo', 'head'],
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

  let next = addCommit(state, {
    id,
    parents: [head],
    message,
    author: 'あなた',
    paths: [...original.paths],
  });

  const branch = currentBranchName(next);
  next = branch ? setBranch(next, branch, id) : setHead(next, { type: 'detached', oid: id });
  next = recordReflog(next, 'revert', message, head, id);

  return ok(
    next,
    [
      `[${branch ?? 'detached HEAD'} ${id}] ${message}`,
      `${target}（${original.message}）を打ち消すコミットを、前に足しました。`,
      '履歴は 1 つも消えていません。reset のように枝を後ろへ動かしてはいないので、',
      '共有済みの履歴でも安全に使えます。',
    ],
    ['repo', 'head'],
  );
}
