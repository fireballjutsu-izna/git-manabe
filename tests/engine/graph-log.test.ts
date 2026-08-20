import { describe, expect, it } from 'vitest';
import { emptyState, run, type RepoState } from '@/lib/git-engine';

/**
 * `git log --graph`。
 *
 * 画面のグラフと**同じ履歴**が、ターミナルにも出ること。
 * 本物を触るときに最初に見るのはこちらなので、
 * 「左の * と | は、右の丸と線と同じもの」だと分かる形にしておく。
 */

function play(lines: string[], from: RepoState = emptyState()): RepoState {
  let state = from;
  for (const line of lines) {
    const result = run(state, line);
    if (result.error) throw new Error(`「${line}」で失敗: ${result.error}`);
    state = result.state;
  }
  return state;
}

/** 絵の部分だけを取り出す（id より前）。 */
function art(state: RepoState, flags = ''): string[] {
  return run(state, `git log --graph${flags}`)
    .log.filter((l) => l.startsWith('*') || l.startsWith('|'))
    .map((l) => l.replace(/([*|\\/ ]*).*/, '$1').trimEnd());
}

describe('まっすぐな履歴', () => {
  it('* が縦に並ぶだけ', () => {
    const state = play([
      'git init',
      'git commit -m 一つ目',
      'git commit -m 二つ目',
      'git commit -m 三つ目',
    ]);
    expect(art(state)).toEqual(['*', '*', '*']);
  });

  it('コミットが無ければ、そう言う', () => {
    expect(run(play(['git init']), 'git log --graph').log.join('\n')).toContain(
      'まだコミットがありません',
    );
  });
});

describe('枝分かれと合流', () => {
  /** main と spring が分かれて、マージで戻る形。 */
  const MERGED = [
    'git init',
    'touch a.txt',
    'git add .',
    'git commit -m 開店',
    'git switch -c spring',
    'touch s.txt',
    'git add .',
    'git commit -m 春の花に替えた',
    'git switch main',
    'touch m.txt',
    'git add .',
    'git commit -m 店長が生け直した',
    'git merge spring',
  ];

  it('本物と同じ形になる', () => {
    /*
     *   *    マージ
     *   |\
     *   * |  店長
     *   | *  春
     *   |/
     *   *    開店
     */
    expect(art(play(MERGED))).toEqual(['*', '|\\', '* |', '| *', '|/', '*']);
  });

  it('斜線は縦線のすぐ隣に置く', () => {
    // 「| \」だと、どこへ繋がる線なのか読めない
    const lines = run(play(MERGED), 'git log --graph').log;
    expect(lines.some((l) => l.trim() === '|\\')).toBe(true);
    expect(lines.some((l) => l.trim() === '|/')).toBe(true);
  });

  it('行は log と同じ並びで、ref も付く', () => {
    const lines = run(play(MERGED), 'git log --graph').log;
    expect(lines[0]).toContain('(HEAD -> main)');
    expect(lines[0]).toContain("Merge branch 'spring'");
    expect(lines.join('\n')).toContain('(spring)');
  });
});

describe('ほかのオプションとの組み合わせ', () => {
  const TWO = [
    'git init',
    'git commit -m 一つ目',
    'git switch -c feature',
    'git commit -m 枝の上',
    'git switch main',
    'git commit -m 幹の上',
  ];

  it('--all を付けると、辿れないぶんも絵に入る', () => {
    const state = play(TWO);
    // feature は main から辿れない
    expect(run(state, 'git log --graph').log.join('\n')).not.toContain('枝の上');

    const text = run(state, 'git log --graph --all').log.join('\n');
    expect(text).toContain('枝の上');
    expect(text).toContain('ここからは辿れません');
  });

  it('-n で絞ると、絞ったぶんだけで絵を引き直す', () => {
    const state = play(TWO);
    const rows = art(state, ' -n 2');
    expect(rows).toHaveLength(2);
  });

  it('絵と行がずれないよう、1 件 1 行にする', () => {
    const state = play(TWO);
    const lines = run(state, 'git log --graph').log;
    // commit / Merge のような複数行の書式は使わない
    expect(lines.some((l) => l.startsWith('commit '))).toBe(false);
  });

  it('画面のグラフと同じものだと言い添える', () => {
    const state = play(TWO);
    expect(run(state, 'git log --graph').log.join('\n')).toContain('画面のグラフと同じもの');
  });
});

describe('レーンの並びは画面のグラフと揃える', () => {
  it('main はいちばん左（レーン 0）に来る', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git switch -c feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
    ]);

    const lines = run(state, 'git log --graph --all').log;
    const trunk = lines.find((l) => l.includes('幹の上')) as string;
    const branch = lines.find((l) => l.includes('枝の上')) as string;

    expect(trunk.startsWith('*')).toBe(true);
    expect(branch.startsWith('|')).toBe(true);
  });
});
