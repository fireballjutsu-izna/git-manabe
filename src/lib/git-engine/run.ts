import {
  GIT_COMMANDS,
  HELPER_COMMANDS,
  PLANNED_COMMANDS,
  parseLine,
  type ParsedCommand,
} from './parse';
import { refreshIgnored } from './ignore';
import { fail, requireNoPause } from './state';
import { add } from './commands/add';
import { branch } from './commands/branch';
import { checkout, switchCommand } from './commands/checkout';
import { commit } from './commands/commit';
import { diff } from './commands/diff';
import { append, edit, touch } from './commands/files';
import { init } from './commands/init';
import { log } from './commands/log';
import { merge } from './commands/merge';
import { cherryPick, revert } from './commands/pick';
import { rebase } from './commands/rebase';
import { reflog } from './commands/reflog';
import { remote, teammate } from './commands/remote';
import { fetch, pull, push } from './commands/sync';
import { reset } from './commands/reset';
import { rm } from './commands/rm';
import { stash } from './commands/stash';
import { status } from './commands/status';
import { tag } from './commands/tag';
import type { CommandResult, RepoState } from './types';

type Handler = (state: RepoState, command: ParsedCommand) => CommandResult;

const GIT_HANDLERS: Record<string, Handler> = {
  init,
  add,
  commit,
  branch,
  checkout,
  switch: switchCommand,
  merge,
  reset,
  rebase,
  'cherry-pick': cherryPick,
  revert,
  stash,
  reflog,
  tag,
  remote,
  push,
  fetch,
  pull,
  status,
  log,
  diff,
  rm,
};

const HELPER_HANDLERS: Record<string, Handler> = {
  touch,
  edit,
  append,
  teammate,
};

/**
 * 途中で止まっている間でも打てるコマンド。
 *
 * 本物の Git も、コンフリクト中は多くの操作を断る ―
 * 決着がついていない状態の上に別の操作を重ねると、収拾がつかなくなるため。
 * ここを絞っておくと、「まず決着をつける／やめる」の 2 択に自然と誘導できる。
 *
 * 見るだけのコマンド（status / log / diff / reflog / branch）と、
 * 決着に要るもの（add / commit / --continue / --abort / touch / edit /
 * checkout --ours・--theirs）だけを通す。
 */
const ALLOWED_WHILE_PAUSED = new Set([
  'add',
  'commit',
  'merge',
  'rebase',
  'cherry-pick',
  'checkout',
  'status',
  'log',
  'diff',
  'reflog',
  'branch',
  'touch',
  'edit',
]);

/**
 * 未実装のコマンドに、代わりになりそうなものを挙げる。
 *
 * 使えるコマンドを全部並べると 19 個になって読まれない。
 * 「そのコマンドで何をしたかったのか」に近いものを 3 つまで出す。
 */
const RELATED: Record<string, string[]> = {
  restore: ['git checkout', 'git reset --hard', 'git stash'],
  mv: ['touch', 'git add'],
  clone: ['git init', 'git remote add', 'git fetch'],
};

function related(name: string): string[] {
  return RELATED[name] ?? ['git status', 'git log'];
}

/** 打ち間違いを拾って「もしかして」を出す。編集距離 1 までを近いとみなす。 */
function nearest(name: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = distance(name, c);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  return bestScore <= 2 ? best : null;
}

function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] =
        a[i - 1] === b[j - 1]
          ? rows[i - 1][j - 1]
          : 1 + Math.min(rows[i - 1][j], rows[i][j - 1], rows[i - 1][j - 1]);
    }
  }
  return rows[a.length][b.length];
}

/**
 * 入力された 1 行を実行する。
 *
 * 状態は書き換えず、必ず新しい RepoState を返す。
 * 解釈できない入力でも例外は投げず、error の付いた CommandResult にする
 * ― 学習サイトなので、間違えたときに何が起きるかまでが教材になる。
 */
export function run(state: RepoState, line: string): CommandResult {
  // .gitignore を書いた瞬間に効き始めてほしいので、出口で一括して付け直す
  const result = dispatch(state, line);
  return result.error ? result : { ...result, state: refreshIgnored(result.state) };
}

function dispatch(state: RepoState, line: string): CommandResult {
  const parsed = parseLine(line);

  if (!parsed.ok) {
    if (!parsed.error) return { state, log: [], touched: [] };
    return fail(state, parsed.error);
  }

  const command = parsed.command;

  if (state.pausing && !ALLOWED_WHILE_PAUSED.has(command.name)) {
    const blocked = requireNoPause(state);
    if (blocked) return blocked;
  }

  if (command.isGit) {
    const handler = GIT_HANDLERS[command.name];
    if (handler) return handler(state, command);

    if ((PLANNED_COMMANDS as readonly string[]).includes(command.name)) {
      // 使えるコマンドを 19 個ぜんぶ並べても読まれない。近いものだけ挙げる
      return fail(
        state,
        `git ${command.name} は、まだこのサイトに入っていません。`,
        `近いものなら ${related(command.name).join(' / ')} が使えます。`,
      );
    }

    const guess = nearest(command.name, [...GIT_COMMANDS, ...PLANNED_COMMANDS]);
    return fail(
      state,
      `git ${command.name} というコマンドはありません。`,
      guess
        ? `もしかして git ${guess} ですか？`
        : `いま使えるのは ${GIT_COMMANDS.join(' / ')} です。`,
    );
  }

  const helper = HELPER_HANDLERS[command.name];
  if (helper) return helper(state, command);

  if ((GIT_COMMANDS as readonly string[]).includes(command.name)) {
    return fail(
      state,
      `${command.name} は Git のコマンドです。`,
      `git ${command.raw} のように、git を付けてください。`,
    );
  }

  const guess = nearest(command.name, [...HELPER_COMMANDS, 'git']);
  return fail(
    state,
    `${command.name} というコマンドはありません。`,
    guess
      ? `もしかして ${guess} ですか？`
      : 'git で始めるか、touch / edit を使ってください。',
  );
}
