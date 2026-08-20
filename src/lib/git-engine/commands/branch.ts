import { hasFlag, type ParsedCommand } from '../parse';
import {
  isAncestor,
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

  // -D は「未マージでも消す」。-d との差がそのまま安全弁になっている
  if (deleting) return deleteBranch(state, name, hasFlag(command, '-D'));
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

  // タグと同じ名前でも作れる（名前空間が別）。ただし名前だけで指せなくなる
  const clashes = state.tags.some((t) => t.name === name);

  return ok(
    setBranch(state, name, target),
    [
      `${name} を ${target} に作りました。`,
      `HEAD は動いていません。移るには git switch ${name} を実行してください。`,
      ...(clashes
        ? [
            '',
            `注意: ${name} というタグもあります。タグと枝は別の入れ物なので同じ名前を持てますが、`,
            `${name} とだけ書いたときに、どちらを指しているのか決められなくなります（枝のほうが選ばれます）。`,
          ]
        : []),
    ],
    ['repo'],
  );
}

function deleteBranch(
  state: RepoState,
  name: string | undefined,
  force: boolean,
): CommandResult {
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

  /*
   * まだどこにも取り込まれていない枝は、-d では消さない。
   *
   * これが -d の存在理由そのもの。名前を外すとそのコミットはどこからも辿れなくなり、
   * 「消えてはいない」とはいえ、気づかなければ失くしたのと同じになる。
   * 本物も the branch is not fully merged と言って -D を要求する。
   */
  const target = findBranch(state, name)?.target;
  const head = headCommitId(state);
  const merged = target && head ? isAncestor(state, target, head) : false;

  if (!force && !merged) {
    return fail(
      state,
      `${name} は、まだどこにも取り込まれていません。`,
      `消すとこの枝のコミットはどこからも辿れなくなります。それでよければ git branch -D ${name} です。`,
    );
  }

  return ok(
    removeBranch(state, name),
    [
      `${name} を消しました。`,
      'コミット自体は消えていません。名前が外れただけです。',
      ...(merged
        ? []
        : [
            'この枝はまだ取り込まれていなかったので、ここにあったコミットはどこからも辿れなくなりました。',
            'git reflog から拾い直せます。',
          ]),
    ],
    ['repo'],
  );
}
