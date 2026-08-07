import type { ParsedCommand } from '../parse';
import {
  aheadBehind,
  currentBranchName,
  fail,
  findBranch,
  findRemote,
  nextCommitId,
  ok,
  requireRepo,
} from '../state';
import type { Commit, CommandResult, Remote, RepoState } from '../types';

/** 既定のリモート名。1 つしか無いときはこれを使う。 */
const DEFAULT = 'origin';

/**
 * `git remote` / `git remote -v` / `git remote add <name> <url>`
 *
 * リモートは「もう 1 つのリポジトリの住所」に名前を付けたもの。
 * 名前を登録するだけで、この時点では何も通信しない。
 */
export function remote(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const sub = command.positional[0];
  if (sub === 'add') return add(state, command);
  if (sub === 'remove' || sub === 'rm') return remove(state, command);
  if (sub === undefined) return list(state, '-v' in command.flags);

  return fail(state, `git remote ${sub} は扱えません。`, '使えるのは add / remove です。');
}

function add(state: RepoState, command: ParsedCommand): CommandResult {
  const name = command.positional[1];
  const url = command.positional[2];
  if (!name) {
    return fail(state, 'リモートの名前を書いてください。', '例: git remote add origin <url>');
  }
  if (findRemote(state, name)) {
    return fail(state, `${name} というリモートはすでにあります。`);
  }

  const entry: Remote = {
    name,
    url: url ?? `https://example.com/${name}.git`,
    commits: {},
    branches: [],
  };

  return ok(
    { ...state, remotes: [...state.remotes, entry] },
    [
      `${name} を登録しました（${entry.url}）。`,
      'まだ何も送っていません。名前を付けただけで、通信はしていません。',
      `送るには git push ${name} を実行してください。`,
    ],
    ['repo'],
  );
}

function remove(state: RepoState, command: ParsedCommand): CommandResult {
  const name = command.positional[1];
  if (!name) return fail(state, '消すリモートの名前を書いてください。');
  if (!findRemote(state, name)) return fail(state, `${name} というリモートはありません。`);

  return ok(
    {
      ...state,
      remotes: state.remotes.filter((r) => r.name !== name),
      remoteBranches: state.remoteBranches.filter((r) => !r.name.startsWith(`${name}/`)),
    },
    [`${name} を消しました。${name}/… の追跡ブランチも一緒に消えます。`],
    ['repo'],
  );
}

function list(state: RepoState, verbose: boolean): CommandResult {
  if (state.remotes.length === 0) {
    return ok(state, ['リモートは登録されていません。', '例: git remote add origin <url>'], []);
  }
  const lines = state.remotes.map((r) => (verbose ? `${r.name}\t${r.url}` : r.name));

  // どれだけ進んでいる／遅れているかも一緒に出す。push が要るのか pull が要るのかが分かる
  const branch = currentBranchName(state);
  if (branch) {
    const tracking = state.remoteBranches.find((r) => r.name.endsWith(`/${branch}`));
    const local = findBranch(state, branch)?.target ?? null;
    if (tracking) {
      const { ahead, behind } = aheadBehind(state, local, tracking.target);
      lines.push('');
      lines.push(`${branch} は ${tracking.name} より ${ahead} 個進み、${behind} 個遅れています。`);
    }
  }
  return ok(state, lines, []);
}

/**
 * `teammate [n]` — Git のコマンドではない。
 *
 * 誰かが向こうへ n 個コミットした、ということにする。
 * これが無いと「手元より進んだリモート」を作れず、
 * fetch と pull がただの空振りになってしまう。
 */
export function teammate(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const target = findRemote(state, command.positional[1] ?? DEFAULT);
  if (!target) {
    return fail(
      state,
      'リモートがありません。',
      '先に git remote add origin <url> を実行してください。',
    );
  }

  const count = Number(command.positional[0] ?? '1');
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    return fail(state, '1 〜 5 の数を指定してください。', '例: teammate 2');
  }

  const branch = currentBranchName(state) ?? 'main';
  const remoteBranch = target.branches.find((b) => b.name === branch);
  if (!remoteBranch) {
    return fail(
      state,
      `${target.name} には ${branch} がまだありません。`,
      `先に git push ${target.name} ${branch} を実行してください。`,
    );
  }

  /*
   * 1 件ずつ state に反映しながら作る。
   * まとめて作ると nextCommitId が「まだ state に入っていない id」を知らず、
   * 同じ id を 2 回返してしまう。
   */
  let next = state;
  let parent = remoteBranch.target;

  for (let i = 0; i < count; i += 1) {
    const seq = next.seq + 1;
    const id = nextCommitId(next);
    const commit: Commit = {
      id,
      parents: [parent],
      message: `同僚の変更 ${i + 1}`,
      author: '同僚',
      createdAt: seq,
      paths: [`teammate-${seq}.txt`],
    };
    parent = id;

    next = {
      ...next,
      seq,
      remotes: next.remotes.map((r) =>
        r.name === target.name ? { ...r, commits: { ...r.commits, [id]: commit } } : r,
      ),
    };
  }

  const tip = parent;
  next = {
    ...next,
    remotes: next.remotes.map((r) =>
      r.name === target.name
        ? { ...r, branches: r.branches.map((b) => (b.name === branch ? { ...b, target: tip } : b)) }
        : r,
    ),
  };

  return ok(
    next,
    [
      `${target.name} の ${branch} に ${count} 件のコミットが増えました。`,
      'あなたのグラフはまだ変わりません。まだ持っていないからです。',
      `git fetch ${target.name} で持ってくると、初めて見えます。`,
    ],
    [],
  );
}

/** リモートの既定を決める。名前が省略されたら、登録されている最初のもの。 */
export function pickRemote(state: RepoState, name: string | undefined): Remote | undefined {
  if (name) return findRemote(state, name);
  return findRemote(state, DEFAULT) ?? state.remotes[0];
}

/** 追跡ブランチの名前（origin/main）。 */
export function trackingName(remoteName: string, branch: string): string {
  return `${remoteName}/${branch}`;
}
