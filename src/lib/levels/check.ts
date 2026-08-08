import { emptyState, run, type RepoState } from '@/lib/git-engine';
import { shapeSignature } from './shape';
import type { Level, LevelResult } from './types';

/**
 * コマンド列を流して状態を作る。
 * レベルの開始状態と、目標の形の両方をこれで用意する。
 */
export function playCommands(lines: string[], from: RepoState = emptyState()): RepoState {
  let state = from;
  for (const line of lines) {
    const result = run(state, line);
    // レベル定義の中の打ち間違いは、黙って無視すると原因が分からなくなる
    if (result.error) {
      throw new Error(`レベルの定義に誤りがあります。「${line}」で失敗: ${result.error}`);
    }
    state = result.state;
  }
  return state;
}

/** レベルの開始状態。 */
export function setupState(level: Level): RepoState {
  return playCommands(level.setup);
}

/** レベルの目標の形。goal が無いレベルでは null。 */
export function goalSignature(level: Level): string | null {
  if (!level.goal) return null;
  return shapeSignature(playCommands(level.goal));
}

/**
 * いまの状態が合格かどうか。
 *
 * 満たせていない条件を言葉で返すのは、
 * 「不正解」とだけ言われても次の一手が決まらないため。
 */
export function checkLevel(level: Level, state: RepoState): LevelResult {
  const missing: string[] = [];

  const goal = goalSignature(level);
  if (goal !== null && shapeSignature(state) !== goal) {
    missing.push('コミットの形か、枝と HEAD の位置が目標と違います。');
  }

  if (level.check && !level.check(state)) {
    missing.push('3 領域か退避の状態が、目標と違います。');
  }

  return { passed: missing.length === 0, missing };
}
