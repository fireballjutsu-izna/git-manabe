import { hasFlag, type ParsedCommand } from '../parse';
import {
  currentBranchName,
  fail,
  findBranch,
  headCommitId,
  ok,
  removeBranch,
  requireRepo,
  setBranch,
} from '../state';
import type { CommandResult, RepoState } from '../types';

/** 枝の名前に使えない書き方を弾く。実際の Git の規則をかなり緩くしたもの。 */
function invalidName(name: string): string | null {
  if (name.startsWith('-')) return '枝の名前を - で始めることはできません。';
  if (/[\s~^:?*[\\]/.test(name)) return '枝の名前に空白や ~ ^ : ? * [ \\ は使えません。';
  if (name.endsWith('/') || name.startsWith('/')) return '枝の名前を / で始めたり終えたりできません。';
  if (name === 'HEAD') return 'HEAD は枝の名前には使えません。';
  return null;
}

/**
 * `git branch` — 一覧
 * `git branch <name>` — いまのコミットに名前を付ける（HEAD は動かない）
 * `git branch -d <name>` — 消す
 *
 * 「枝を作ってもそこへ移動はしない」ことがいちばん誤解されるので、
 * 作成時のログでそれを毎回言う。
 */
export function branch(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const deleting = hasFlag(command, '-d', '-D', '--delete');
  const name = command.positional[0];

  if (deleting) return deleteBranch(state, name);
  if (!name) return listBranches(state);
  return createBranch(state, name);
}

function listBranches(state: RepoState): CommandResult {
  if (state.branches.length === 0) {
    return ok(state, ['枝はまだ 1 つもありません。最初の commit が最初の枝を生みます。'], []);
  }
  const current = currentBranchName(state);
  const lines = state.branches.map((b) =>
    b.name === current ? `* ${b.name}  ${b.target}` : `  ${b.name}  ${b.target}`,
  );
  if (state.head.type === 'detached') {
    lines.unshift(`* (detached HEAD ${state.head.oid})`);
  }
  return ok(state, lines, []);
}

function createBranch(state: RepoState, name: string): CommandResult {
  const bad = invalidName(name);
  if (bad) return fail(state, bad);

  if (findBranch(state, name)) {
    return fail(state, `${name} という枝はすでにあります。`);
  }

  const target = headCommitId(state);
  if (!target) {
    return fail(
      state,
      'まだコミットが 1 つもないので、枝を作れません。',
      '枝は「あるコミットに付ける名前」なので、先に git commit が要ります。',
    );
  }

  return ok(
    setBranch(state, name, target),
    [
      `${name} を ${target} に作りました。`,
      `HEAD は動いていません。移るには git switch ${name} を実行してください。`,
    ],
    ['repo'],
  );
}

function deleteBranch(state: RepoState, name: string | undefined): CommandResult {
  if (!name) return fail(state, '消す枝の名前を書いてください。', '例: git branch -d feature');

  if (!findBranch(state, name)) {
    return fail(state, `${name} という枝はありません。`);
  }
  if (currentBranchName(state) === name) {
    return fail(
      state,
      `いま ${name} の上にいるので、この枝は消せません。`,
      '別の枝へ switch してから消してください。',
    );
  }

  return ok(
    removeBranch(state, name),
    [
      `${name} を消しました。`,
      'コミット自体は消えていません。名前が外れただけです。',
    ],
    ['repo'],
  );
}
