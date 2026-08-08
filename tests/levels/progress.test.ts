import { describe, expect, it } from 'vitest';
import {
  clearedCount,
  emptyProgress,
  isCleared,
  markCleared,
  markStudied,
  today,
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
