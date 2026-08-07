/**
 * 状態のスナップショット列。undo / redo とレベルのリセットを、これ 1 つで賄う。
 *
 * 各コマンドが新しい RepoState を返す純粋関数なので、
 * 「差分を戻す」ではなく「前の状態をそのまま持っておく」で済む。
 */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** 積んでおく上限。学習用なので、これ以上遡れなくても困らない。 */
const LIMIT = 200;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** 新しい状態を積む。やり直せる先（future）は捨てる。 */
export function pushHistory<T>(history: History<T>, next: T): History<T> {
  const past = [...history.past, history.present];
  return {
    past: past.length > LIMIT ? past.slice(past.length - LIMIT) : past,
    present: next,
    future: [],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  const present = history.past[history.past.length - 1];
  return { past, present, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}

/** 最初からやり直す。 */
export function resetHistory<T>(initial: T): History<T> {
  return initHistory(initial);
}
