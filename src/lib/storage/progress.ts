/**
 * 学習の記録。サーバは使わず localStorage だけで完結する。
 *
 * 溜まるのは「どのレベルをいつ通したか」と「何日続いたか」だけ。
 * 点数は付けない ― competing させたいのではなく、
 * 戻ってくる理由を 1 つ作りたいだけなので。
 */

const KEY = 'git-manabe:progress:v1';

/** シナリオを 1 本終えた記録。 */
export interface ScenarioRecord {
  /** 最初に終えた日（YYYY-MM-DD）。 */
  day: string;
  /** そのときの星（1〜3）。良いほうを残す。 */
  stars: number;
  /** 星の元になった手数。良いほう（少ないほう）を残す。 */
  moves: number;
}

export interface Progress {
  /** レベル id → 通した日（YYYY-MM-DD）。 */
  cleared: Record<string, string>;
  /** シナリオ id → その記録。 */
  scenarios: Record<string, ScenarioRecord>;
  /** 連続で学習した日数。 */
  streak: number;
  /** 最後に学習した日（YYYY-MM-DD）。 */
  lastStudied: string | null;
}

export const emptyProgress = (): Progress => ({
  cleared: {},
  scenarios: {},
  streak: 0,
  lastStudied: null,
});

/** その土地の時刻での YYYY-MM-DD。UTC にすると日付が 1 日ずれる人が出る。 */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return today(prev);
}

/**
 * 学習した日として記録し、連続日数を更新する。
 *
 * 日付を引数で受けるのは、テストで時計を差し替えずに済ませるため。
 */
export function markStudied(progress: Progress, day: string): Progress {
  if (progress.lastStudied === day) return progress;

  const continued = progress.lastStudied === dayBefore(day);
  return {
    ...progress,
    streak: continued ? progress.streak + 1 : 1,
    lastStudied: day,
  };
}

/** レベルを通した記録。同じレベルを 2 度通しても、最初の日付を残す。 */
export function markCleared(progress: Progress, levelId: string, day: string): Progress {
  const next = markStudied(progress, day);
  if (next.cleared[levelId]) return next;
  return { ...next, cleared: { ...next.cleared, [levelId]: day } };
}

/**
 * シナリオを終えた記録。
 *
 * 2 度目に手数が増えても星は下げない。
 * 「一度出した記録が、遊び直したせいで消える」のは理不尽なので。
 */
export function markScenarioCleared(
  progress: Progress,
  id: string,
  stars: number,
  moves: number,
  day: string,
): Progress {
  const next = markStudied(progress, day);
  const before = next.scenarios[id];
  const record: ScenarioRecord = before
    ? {
        day: before.day,
        stars: Math.max(before.stars, stars),
        moves: Math.min(before.moves, moves),
      }
    : { day, stars, moves };

  return { ...next, scenarios: { ...next.scenarios, [id]: record } };
}

export function scenarioRecord(progress: Progress, id: string): ScenarioRecord | undefined {
  return progress.scenarios[id];
}

export function scenarioClearedCount(progress: Progress): number {
  return Object.keys(progress.scenarios).length;
}

export function isCleared(progress: Progress, levelId: string): boolean {
  return progress.cleared[levelId] !== undefined;
}

export function clearedCount(progress: Progress): number {
  return Object.keys(progress.cleared).length;
}

/* ---- localStorage との出し入れ ---- */

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      cleared: parsed.cleared ?? {},
      // 途中から足した項目。古い記録には無いので、既定を置いておく
      scenarios: parsed.scenarios ?? {},
      streak: parsed.streak ?? 0,
      lastStudied: parsed.lastStudied ?? null,
    };
  } catch {
    // プライベートブラウジング等で読めなくても、学習の妨げにはしない
    return emptyProgress();
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    /* 保存できなくても、その場の学習は続けられる */
  }
}

export function resetProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 消せなくても実害はない */
  }
}
