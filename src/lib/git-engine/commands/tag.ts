import { fail, headCommitId, ok, requireRepo, resolveRevision } from '../state';
import type { ParsedCommand } from '../parse';
import type { CommandResult, RepoState } from '../types';

/**
 * `git tag`
 *
 * 枝との違いは 1 つだけ ― **タグは動かない**。
 * 枝はコミットするたびに前へ進むが、タグは付けたコミットに留まり続ける。
 * 「この時点のもの」と言いたいときのための名前で、リリースの目印に使う。
 */
export function tag(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const remove = command.flags['-d'] === true || command.flags['--delete'] === true;
  const [name, at] = command.positional;

  if (remove) return removeTag(state, name);
  if (!name) return listTags(state);
  return addTag(state, name, at);
}

function listTags(state: RepoState): CommandResult {
  if (state.tags.length === 0) {
    return ok(
      state,
      ['タグはまだありません。', '例: git tag v1.0 で、いまのコミットに目印を付けられます。'],
      [],
    );
  }

  const lines = [...state.tags]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((t) => `${t.name}  ${t.target}  ${state.commits[t.target]?.message ?? ''}`);

  return ok(state, [...lines, '', `${state.tags.length} 件。タグは動きません。`], []);
}

function addTag(state: RepoState, name: string, at: string | undefined): CommandResult {
  if (state.tags.some((t) => t.name === name)) {
    return fail(state, `${name} というタグはもうあります。`, `付け替えるなら git tag -d ${name} で外してからです。`);
  }
  if (state.branches.some((b) => b.name === name)) {
    return fail(
      state,
      `${name} は枝の名前として使われています。`,
      'タグと枝で同じ名前を使うと、どちらを指しているのか分からなくなります。',
    );
  }

  const target = at ? resolveRevision(state, at) : headCommitId(state);
  if (target === 'ambiguous') {
    return fail(state, `${at} がどれを指すのか決められません。`, 'コミットの id で指定してください。');
  }
  if (!target) {
    return at
      ? fail(state, `${at} というコミットも枝もありません。`, 'git log で確かめてください。')
      : fail(state, 'まだコミットが 1 つもありません。', '先に git commit をしてください。');
  }

  const next: RepoState = { ...state, tags: [...state.tags, { name, target }] };
  const commit = state.commits[target];

  return ok(
    next,
    [
      `${name} を ${target} に付けました（${commit?.message ?? ''}）。`,
      'タグはここから動きません。このあとコミットしても、付いたままです。',
      '枝との違いはそこだけです ― 枝は付いていったコミットごと前へ進みます。',
    ],
    ['repo'],
  );
}

function removeTag(state: RepoState, name: string): CommandResult {
  if (!name) return fail(state, '外すタグの名前を書いてください。', '例: git tag -d v1.0');
  if (!state.tags.some((t) => t.name === name)) {
    return fail(state, `${name} というタグはありません。`, '一覧は git tag で見られます。');
  }

  return ok(
    { ...state, tags: state.tags.filter((t) => t.name !== name) },
    [`${name} を外しました。`, 'コミット自体は消えていません。目印が外れただけです。'],
    ['repo'],
  );
}
