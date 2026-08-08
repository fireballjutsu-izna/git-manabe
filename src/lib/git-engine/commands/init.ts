import { emptyState, fail, ok } from '../state';
import type { CommandResult, RepoState } from '../types';

/**
 * `git init`
 *
 * 直後は main という枝が**まだ存在しない**。
 * HEAD は「これから作られる main」を指していて、最初のコミットがその枝を生む。
 * 実際の Git と同じ（unborn HEAD）で、ここを省くと detached HEAD の話が通じなくなる。
 */
export function init(state: RepoState): CommandResult {
  if (state.initialized) {
    return fail(
      state,
      'すでにリポジトリがあります。',
      'やり直したいときは、画面のリセットボタンを押してください。',
    );
  }

  const next: RepoState = { ...emptyState(), initialized: true };

  return ok(
    next,
    [
      '空のリポジトリを作りました。',
      'HEAD は main を指していますが、main という枝はまだありません。',
      '最初の commit が、その枝を生みます。',
    ],
    ['repo', 'head'],
  );
}
