import { changedPaths, formatFileDiff } from '../content';
import { hasFlag, type ParsedCommand } from '../parse';
import { fail, headCommitId, joinJa, ok, requireRepo, resolveRevision, treeOf } from '../state';
import type { CommandResult, RepoState, Tree } from '../types';

/**
 * `git diff`
 *
 * 「いま何が変わっているか」を、行で見る。
 *
 *   git diff              作業ディレクトリ ↔ ステージ（まだ add していないぶん）
 *   git diff --staged     ステージ ↔ HEAD（add したが、まだコミットしていないぶん）
 *   git diff <commit>     そのコミット ↔ 作業ディレクトリ
 *   git diff <a> <b>      コミットどうし
 *
 * 引数なしと --staged の違いが、この章のいちばんの山。
 * **add したものは git diff に出てこない** ―「変更したのに diff が空」で
 * 戸惑うのはここで、3 領域のどこを比べているかが分かれば一発で解ける。
 */
export function diff(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const staged = hasFlag(command, '--staged', '--cached');
  const specs = command.positional;

  if (staged && specs.length > 0) {
    return fail(
      state,
      '--staged とコミットの指定は、いっしょに使えません。',
      '--staged はステージと HEAD を比べる書き方です。',
    );
  }

  if (staged) {
    return show(
      state,
      treeOf(state, headCommitId(state)),
      state.stage,
      'HEAD',
      'ステージ',
      'add はしたが、まだコミットしていないぶんです。',
    );
  }

  if (specs.length === 0) {
    return show(
      state,
      state.stage,
      state.work,
      'ステージ',
      '作業ディレクトリ',
      'まだ add していないぶんです。add したものはここに出ません（git diff --staged で見られます）。',
    );
  }

  const from = resolve(state, specs[0]);
  if ('error' in from) return from.error;

  if (specs.length === 1) {
    return show(
      state,
      treeOf(state, from.id),
      state.work,
      specs[0],
      '作業ディレクトリ',
      'コミットと、いま手元にあるものを比べています。',
    );
  }

  const to = resolve(state, specs[1]);
  if ('error' in to) return to.error;

  return show(
    state,
    treeOf(state, from.id),
    treeOf(state, to.id),
    specs[0],
    specs[1],
    'コミットどうしを比べています。手元の状態は関係ありません。',
  );
}

function resolve(state: RepoState, spec: string): { id: string } | { error: CommandResult } {
  const id = resolveRevision(state, spec);
  if (id === 'ambiguous') {
    return {
      error: fail(state, `${spec} で始まるコミットが複数あります。`, 'もう少し長く書いてください。'),
    };
  }
  if (!id) return { error: fail(state, `${spec} という枝もコミットもありません。`) };
  return { id };
}

function show(
  state: RepoState,
  before: Tree,
  after: Tree,
  beforeLabel: string,
  afterLabel: string,
  note: string,
): CommandResult {
  const paths = changedPaths(before, after);

  if (paths.length === 0) {
    return ok(state, [joinJa(beforeLabel, 'と', afterLabel, 'に違いはありません。'), note], []);
  }

  const lines: string[] = [];
  for (const path of paths) {
    lines.push(...formatFileDiff(path, before[path], after[path]));
  }

  lines.push('');
  lines.push(`${paths.length} 件に違いがあります（${beforeLabel} → ${afterLabel}）。`);
  lines.push(note);

  return ok(state, lines, []);
}
