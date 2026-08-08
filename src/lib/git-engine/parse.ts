/**
 * 入力された 1 行を、コマンドの形に切り分ける。
 *
 * 本物のシェルではないので、扱うのは次だけ:
 *   - 空白区切り
 *   - "…" と '…' の引用（中の空白は 1 つのトークンになる）
 *   - -x / --xxx のフラグ
 *
 * -m だけは特別で、**そのあとの残り全部**をメッセージにする。
 * `git commit -m 最初のコミット` のように引用符を書き忘れても意図どおり動かすため。
 */

export interface ParsedCommand {
  /** 入力そのまま。ログに残す。 */
  raw: string;
  /** 'commit' / 'branch' / 'touch' など。 */
  name: string;
  /** `git` から始まっていたか。touch や edit は false。 */
  isGit: boolean;
  /** -m の値のように値を伴うものは string、--detach のような素のフラグは true。 */
  flags: Record<string, string | true>;
  positional: string[];
}

export type ParseResult = { ok: true; command: ParsedCommand } | { ok: false; error: string };

/** git のあとに置ける、このサイトが解釈するサブコマンド。 */
export const GIT_COMMANDS = [
  'init',
  'add',
  'commit',
  'branch',
  'checkout',
  'switch',
  'merge',
  'reset',
  'rebase',
  'cherry-pick',
  'revert',
  'stash',
  'reflog',
  'tag',
  'remote',
  'push',
  'fetch',
  'pull',
  'status',
  'log',
  'diff',
] as const;

/** Git のコマンドではないが、サンドボックスの中でだけ使える補助コマンド。 */
export const HELPER_COMMANDS = ['touch', 'edit', 'teammate'] as const;

/**
 * 実際の Git にはあるが、このサイトではまだ実装していないもの。
 * 打たれたときに「知らない」ではなく「まだ」と返すために持っておく。
 */
export const PLANNED_COMMANDS = [
  'restore',
  'rm',
  'mv',
  'clone',
] as const;

/** 空白区切りに切る。引用の中の空白は残す。 */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '　') {
      if (current || hasContent) tokens.push(current);
      current = '';
      hasContent = false;
      continue;
    }
    current += ch;
  }
  if (current || hasContent) tokens.push(current);
  return tokens;
}

/** -m のように、そのあとの残り全部を値として飲み込むフラグ。 */
const REST_OF_LINE_FLAGS = new Set(['-m', '--message']);

export function parseLine(line: string): ParseResult {
  const raw = line.trim();
  if (!raw) return { ok: false, error: '' };

  const tokens = tokenize(raw);
  const first = tokens[0];

  let name: string;
  let isGit: boolean;
  let rest: string[];

  if (first === 'git') {
    if (tokens.length === 1) {
      return {
        ok: false,
        error: `git のあとにコマンドを続けてください。使えるのは ${GIT_COMMANDS.join(' / ')} です。`,
      };
    }
    isGit = true;
    name = tokens[1];
    rest = tokens.slice(2);
  } else {
    isGit = false;
    name = first;
    rest = tokens.slice(1);
  }

  const flags: Record<string, string | true> = {};
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('-') || token === '-') {
      positional.push(token);
      continue;
    }
    if (REST_OF_LINE_FLAGS.has(token)) {
      const value = rest.slice(i + 1).join(' ');
      if (!value) return { ok: false, error: `${token} のあとにメッセージを書いてください。` };
      flags[token] = value;
      break;
    }
    flags[token] = true;
  }

  return { ok: true, command: { raw, name, isGit, flags, positional } };
}

/** 複数の書き方があるフラグを、1 つにまとめて読む。 */
export function flagValue(
  command: ParsedCommand,
  ...names: string[]
): string | true | undefined {
  for (const n of names) {
    if (n in command.flags) return command.flags[n];
  }
  return undefined;
}

export function hasFlag(command: ParsedCommand, ...names: string[]): boolean {
  return names.some((n) => n in command.flags);
}
