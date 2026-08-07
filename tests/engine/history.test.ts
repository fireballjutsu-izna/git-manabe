import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  emptyState,
  initHistory,
  pushHistory,
  redo,
  run,
  undo,
  type History,
  type RepoState,
} from '@/lib/git-engine';

/** コマンド列を、履歴に積みながら流す。 */
function playWithHistory(lines: string[]): History<RepoState> {
  let history = initHistory(emptyState());
  for (const line of lines) {
    const result = run(history.present, line);
    if (result.error) throw new Error(`「${line}」で失敗: ${result.error}`);
    history = pushHistory(history, result.state);
  }
  return history;
}

const LINES = [
  'git init',
  'git commit -m one',
  'git branch feature',
  'git switch feature',
  'git commit -m two',
];

describe('undo / redo', () => {
  it('何も積んでいなければ、どちらもできない', () => {
    const history = initHistory(emptyState());
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it('5 手打って 3 手戻し、2 手やり直すと、4 手目の状態に戻る', () => {
    const full = playWithHistory(LINES);
    const fourSteps = playWithHistory(LINES.slice(0, 4));

    let history = full;
    for (let i = 0; i < 3; i += 1) history = undo(history);
    for (let i = 0; i < 2; i += 1) history = redo(history);

    expect(history.present).toEqual(fourSteps.present);
  });

  it('全部戻すと、git init の前まで帰れる', () => {
    let history = playWithHistory(LINES);
    while (canUndo(history)) history = undo(history);
    expect(history.present).toEqual(emptyState());
    expect(canRedo(history)).toBe(true);
  });

  it('戻したあとに新しく積むと、やり直せる先は消える', () => {
    let history = playWithHistory(LINES);
    history = undo(history);
    expect(canRedo(history)).toBe(true);

    const result = run(history.present, 'git commit -m 別の道');
    history = pushHistory(history, result.state);

    expect(canRedo(history)).toBe(false);
    expect(history.past).not.toHaveLength(0);
  });

  it('往復しても状態は壊れない', () => {
    const full = playWithHistory(LINES);
    let history = full;
    for (let i = 0; i < 4; i += 1) history = undo(history);
    for (let i = 0; i < 4; i += 1) history = redo(history);
    expect(history.present).toEqual(full.present);
  });
});
