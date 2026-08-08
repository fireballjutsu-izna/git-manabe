import { describe, expect, it } from 'vitest';
import {
  clearedCount,
  emptyProgress,
  isCleared,
  markCleared,
  markScenarioCleared,
  markStudied,
  scenarioClearedCount,
  today,
  type Progress,
} from '@/lib/storage/progress';

/**
 * 連続日数の計算。
 *
 * 日付を引数で受け取る形にしてあるので、時計を差し替えずに検査できる。
 * 「昨日」の判定は月またぎ・年またぎで間違えやすいので、そこを重点的に見る。
 */

describe('today()', () => {
  it('その土地の時刻で YYYY-MM-DD を返す', () => {
    // 現地時刻の 1 月 5 日 23:30。UTC で計算すると 1 月 6 日にずれる地域がある
    expect(today(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('1 桁の月日を 0 で埋める', () => {
    expect(today(new Date(2026, 8, 3))).toBe('2026-09-03');
  });
});

describe('連続日数', () => {
  it('初日は 1 になる', () => {
    expect(markStudied(emptyProgress(), '2026-05-01').streak).toBe(1);
  });

  it('翌日に続けると増える', () => {
    let p = markStudied(emptyProgress(), '2026-05-01');
    p = markStudied(p, '2026-05-02');
    p = markStudied(p, '2026-05-03');
    expect(p.streak).toBe(3);
  });

  it('同じ日に何度学習しても増えない', () => {
    let p = markStudied(emptyProgress(), '2026-05-01');
    p = markStudied(p, '2026-05-01');
    p = markStudied(p, '2026-05-01');
    expect(p.streak).toBe(1);
  });

  it('1 日空くと 1 に戻る', () => {
    let p = markStudied(emptyProgress(), '2026-05-01');
    p = markStudied(p, '2026-05-03');
    expect(p.streak).toBe(1);
  });

  it('月をまたいでも続く', () => {
    let p = markStudied(emptyProgress(), '2026-01-31');
    p = markStudied(p, '2026-02-01');
    expect(p.streak).toBe(2);
  });

  it('年をまたいでも続く', () => {
    let p = markStudied(emptyProgress(), '2025-12-31');
    p = markStudied(p, '2026-01-01');
    expect(p.streak).toBe(2);
  });

  it('うるう日をまたいでも続く', () => {
    let p = markStudied(emptyProgress(), '2028-02-28');
    p = markStudied(p, '2028-02-29');
    p = markStudied(p, '2028-03-01');
    expect(p.streak).toBe(3);
  });
});

describe('クリアの記録', () => {
  it('クリアすると、その日付が残る', () => {
    const p = markCleared(emptyProgress(), 'areas', '2026-05-01');
    expect(isCleared(p, 'areas')).toBe(true);
    expect(p.cleared.areas).toBe('2026-05-01');
    expect(clearedCount(p)).toBe(1);
  });

  it('2 度目のクリアでは、最初の日付を上書きしない', () => {
    let p = markCleared(emptyProgress(), 'areas', '2026-05-01');
    p = markCleared(p, 'areas', '2026-05-09');
    expect(p.cleared.areas).toBe('2026-05-01');
    expect(clearedCount(p)).toBe(1);
  });

  it('別の日にクリアすると、連続日数も動く', () => {
    let p = markCleared(emptyProgress(), 'areas', '2026-05-01');
    p = markCleared(p, 'branch', '2026-05-02');
    expect(clearedCount(p)).toBe(2);
    expect(p.streak).toBe(2);
  });

  it('元の記録を書き換えない', () => {
    const before = markCleared(emptyProgress(), 'areas', '2026-05-01');
    const snapshot = structuredClone(before);
    markCleared(before, 'branch', '2026-05-02');
    expect(before).toEqual(snapshot);
  });
});

describe('シナリオの記録', () => {
  it('終えると、星と手数が残る', () => {
    const p = markScenarioCleared(emptyProgress(), 'hotfix', 3, 10, '2026-05-01');
    expect(p.scenarios.hotfix).toEqual({ day: '2026-05-01', stars: 3, moves: 10 });
    expect(scenarioClearedCount(p)).toBe(1);
  });

  it('2 度目に手数が増えても、星は下げない', () => {
    // 一度出した記録が、遊び直したせいで消えるのは理不尽なので
    let p = markScenarioCleared(emptyProgress(), 'hotfix', 3, 10, '2026-05-01');
    p = markScenarioCleared(p, 'hotfix', 1, 30, '2026-05-02');
    expect(p.scenarios.hotfix.stars).toBe(3);
    expect(p.scenarios.hotfix.moves).toBe(10);
  });

  it('2 度目に良くなったら、そちらを残す', () => {
    let p = markScenarioCleared(emptyProgress(), 'hotfix', 1, 30, '2026-05-01');
    p = markScenarioCleared(p, 'hotfix', 3, 10, '2026-05-02');
    expect(p.scenarios.hotfix.stars).toBe(3);
    expect(p.scenarios.hotfix.moves).toBe(10);
  });

  it('初めて終えた日は上書きしない', () => {
    let p = markScenarioCleared(emptyProgress(), 'hotfix', 1, 30, '2026-05-01');
    p = markScenarioCleared(p, 'hotfix', 3, 10, '2026-05-09');
    expect(p.scenarios.hotfix.day).toBe('2026-05-01');
  });

  it('連続日数も一緒に動く', () => {
    let p = markScenarioCleared(emptyProgress(), 'hotfix', 3, 10, '2026-05-01');
    p = markScenarioCleared(p, 'review', 3, 5, '2026-05-02');
    expect(p.streak).toBe(2);
  });

  it('元の記録を書き換えない', () => {
    const before = markScenarioCleared(emptyProgress(), 'hotfix', 3, 10, '2026-05-01');
    const snapshot = structuredClone(before);
    markScenarioCleared(before, 'review', 3, 5, '2026-05-02');
    expect(before).toEqual(snapshot);
  });

  it('古い記録（scenarios が無い）を読んでも壊れない', () => {
    // 途中から足した項目なので、既存の利用者の localStorage には入っていない
    const old = { cleared: { areas: '2026-01-01' }, streak: 1, lastStudied: '2026-01-01' };
    const p: Progress = { ...emptyProgress(), ...old };
    expect(() => markScenarioCleared(p, 'hotfix', 3, 10, '2026-05-01')).not.toThrow();
  });
});
