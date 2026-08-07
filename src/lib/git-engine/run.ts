import {
  GIT_COMMANDS,
  HELPER_COMMANDS,
  PLANNED_COMMANDS,
  parseLine,
  type ParsedCommand,
} from './parse';
import { fail } from './state';
import { add } from './commands/add';
import { branch } from './commands/branch';
import { checkout, switchCommand } from './commands/checkout';
import { commit } from './commands/commit';
import { edit, touch } from './commands/files';
import { init } from './commands/init';
import { log } from './commands/log';
import { merge } from './commands/merge';
import { cherryPick, revert } from './commands/pick';
import { rebase } from './commands/rebase';
import { reset } from './commands/reset';
import { stash } from './commands/stash';
import { status } from './commands/status';
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
  status,
  log,
};

const HELPER_HANDLERS: Record<string, Handler> = {
  touch,
  edit,
};

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
  const parsed = parseLine(line);

  if (!parsed.ok) {
    if (!parsed.error) return { state, log: [], touched: [] };
    return fail(state, parsed.error);
  }

  const command = parsed.command;

  if (command.isGit) {
    const handler = GIT_HANDLERS[command.name];
    if (handler) return handler(state, command);

    if ((PLANNED_COMMANDS as readonly string[]).includes(command.name)) {
      return fail(
        state,
        `git ${command.name} は、まだこのサイトに入っていません。`,
        `いま使えるのは ${GIT_COMMANDS.join(' / ')} です。`,
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
