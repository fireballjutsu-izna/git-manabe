import { hasFlag, type ParsedCommand } from '../parse';
import {
  currentBranchName,
  fail,
  findBranch,
  headCommitId,
  ok,
  recordReflog,
  requireRepo,
  resolveCommit,
  setBranch,
  setHead,
} from '../state';
import type { CommandResult, RepoState } from '../types';

/**
 * `git checkout <branch|commit>` / `git switch <branch>`
 *
 * HEAD を動かすだけのコマンド。作業ディレクトリとステージには手を触れない
 * （このサイトはファイルの中身を持たないので、移動でぶつかることがない）。
 *
 * checkout と switch の違いも、そのまま再現する:
 *   checkout はコミットを直に指せて、その結果 detached HEAD になる
 *   switch は枝しか受け取らない（コミットを指すには --detach が要る）
 * この差は「detached HEAD は事故ではなく、意図して入るモード」という話に効いてくる。
 */
export function checkout(state: RepoState, command: ParsedCommand): CommandResult {
  return move(state, command, 'checkout');
}

export function switchCommand(state: RepoState, command: ParsedCommand): CommandResult {
  return move(state, command, 'switch');
}

function move(state: RepoState, command: ParsedCommand, as: 'checkout' | 'switch'): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const creating = hasFlag(command, as === 'checkout' ? '-b' : '-c', '-B', '-C');
  const target = command.positional[0];

  if (!target) {
    return fail(
      state,
      as === 'checkout' ? 'どこへ移るのか書いてください。' : 'どの枝へ移るのか書いてください。',
      as === 'checkout' ? '例: git checkout main' : '例: git switch main',
    );
  }

  if (creating) return createAndMove(state, target, as);

  const branch = findBranch(state, target);
  if (branch) return moveToBranch(state, target, branch.target);

  // 枝ではないので、コミットの直接指定として読む
  const detachAllowed = as === 'checkout' || hasFlag(command, '--detach');
  const resolved = resolveCommit(state, target);

  if (resolved === 'ambiguous') {
    return fail(
      state,
      `${target} で始まるコミットが複数あります。`,
      'もう少し長く書いてください。',
    );
  }
  if (!resolved) {
    return fail(
      state,
      `${target} という枝もコミットもありません。`,
      '枝の一覧は git branch、コミットの一覧は git log で見られます。',
    );
  }
  if (!detachAllowed) {
    return fail(
      state,
      `${target} は枝ではなくコミットです。switch は枝にしか移れません。`,
      `コミットを直接指すなら git switch --detach ${target} か git checkout ${target} です。`,
    );
  }

  return moveToCommit(state, resolved);
}

function createAndMove(state: RepoState, name: string, as: 'checkout' | 'switch'): CommandResult {
  if (findBranch(state, name)) {
    return fail(
      state,
      `${name} という枝はすでにあります。`,
      `移るだけなら git ${as === 'checkout' ? 'checkout' : 'switch'} ${name} です。`,
    );
  }
  const target = headCommitId(state);
  if (!target) {
    return fail(
      state,
      'まだコミットが 1 つもないので、枝を作れません。',
      '先に git commit を実行してください。',
    );
  }

  const withBranch = setBranch(state, name, target);
  const from = headCommitId(withBranch);
  let next = setHead(withBranch, { type: 'branch', ref: name });
  next = recordReflog(next, 'checkout', `${name} を作って移動`, from, target);

  return ok(
    next,
    [`${name} を ${target} に作り、そこへ移りました。`],
    ['repo', 'head'],
  );
}

function moveToBranch(state: RepoState, name: string, target: string): CommandResult {
  if (currentBranchName(state) === name) {
    return ok(state, [`すでに ${name} の上にいます。`], []);
  }

  const from = headCommitId(state);
  const wasDetached = state.head.type === 'detached';

  let next = setHead(state, { type: 'branch', ref: name });
  next = recordReflog(next, 'checkout', `${name} へ移動`, from, target);

  const lines = [`${name} へ移りました。`];
  if (wasDetached) {
    lines.push('detached HEAD から抜けました。HEAD はまた枝を指しています。');
  }

  return ok(next, lines, ['head']);
}

function moveToCommit(state: RepoState, oid: string): CommandResult {
  const from = headCommitId(state);
  if (state.head.type === 'detached' && state.head.oid === oid) {
    return ok(state, [`すでに ${oid} にいます。`], []);
  }

  let next = setHead(state, { type: 'detached', oid });
  next = recordReflog(next, 'checkout', `${oid} へ移動（detached）`, from, oid);

  return ok(
    next,
    [
      `${oid} へ移りました。いまは detached HEAD です。`,
      'HEAD がどの枝も指していない状態です。ここでコミットしても、どの枝も伸びません。',
      '枝に戻るには git switch <枝の名前> を実行してください。',
    ],
    ['head'],
  );
}
