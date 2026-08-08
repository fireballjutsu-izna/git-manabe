import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, run, type RepoState } from '@/lib/git-engine';

/**
 * コンフリクト。
 *
 * ここで確かめたいのは「止まる」「そこから 2 通りに抜けられる」の 2 点で、
 * どちらもデータの形で表せる ― merging が入るか、消えるか。
 * 学習者が怖がるのは「壊れたかもしれない」なので、
 * **--abort が本当に元通りにする**ことは、特に強く固定しておく。
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

/** 両側が同じ a.txt を変えた形。ここから merge するとぶつかる。 */
const CLASHING = [
  'git init',
  'touch a.txt',
  'touch b.txt',
  'git add .',
  'git commit -m 根',
  'git switch -c feature',
  'edit a.txt',
  'git add .',
  'git commit -m 枝で a を変更',
  'git switch main',
  'edit a.txt',
  'git add .',
  'git commit -m 幹で a を変更',
];

/** 両側が別のファイルを変えた形。分岐していてもぶつからない。 */
const SEPARATE = [
  'git init',
  'touch a.txt',
  'touch b.txt',
  'git add .',
  'git commit -m 根',
  'git switch -c feature',
  'edit a.txt',
  'git add .',
  'git commit -m 枝で a を変更',
  'git switch main',
  'edit b.txt',
  'git add .',
  'git commit -m 幹で b を変更',
];

describe('ぶつかるかどうかの判定', () => {
  it('両側が同じファイルを変えていたら止まる', () => {
    const result = run(play(CLASHING), 'git merge feature');

    expect(result.error).toBeUndefined();
    expect(result.state.merging?.conflicts).toEqual(['a.txt']);
    expect(result.log.join('\n')).toContain('a.txt');
    expect(result.log.join('\n')).toContain('壊れてはいません');
  });

  it('別々のファイルなら、止まらずにマージできる', () => {
    const result = run(play(SEPARATE), 'git merge feature');

    expect(result.error).toBeUndefined();
    expect(result.state.merging).toBeNull();
    const head = headCommitId(result.state) as string;
    expect(result.state.commits[head].parents).toHaveLength(2);
  });

  it('止まってもコミットは増えない', () => {
    const before = play(CLASHING);
    const after = run(before, 'git merge feature').state;
    expect(Object.keys(after.commits)).toHaveLength(Object.keys(before.commits).length);
  });

  it('止まっている間、枝はどれも動いていない', () => {
    const before = play(CLASHING);
    const after = run(before, 'git merge feature').state;
    expect(after.branches).toEqual(before.branches);
    expect(after.head).toEqual(before.head);
  });

  it('ぶつかったファイルは conflicted になる', () => {
    const state = play([...CLASHING, 'git merge feature']);
    expect(state.workingDir).toEqual([{ path: 'a.txt', status: 'conflicted' }]);
  });
});

describe('止まっている間にできること', () => {
  const paused = () => play([...CLASHING, 'git merge feature']);

  it('status がコンフリクトを知らせる', () => {
    const result = run(paused(), 'git status');
    const text = result.log.join('\n');
    expect(text).toContain('途中で止まっています');
    expect(text).toContain('両方が変更: a.txt');
  });

  it('関係のないコマンドは断られ、状態も変わらない', () => {
    const before = paused();
    for (const line of ['git switch feature', 'git rebase feature', 'git reset --hard HEAD~1']) {
      const result = run(before, line);
      expect(result.error, line).toContain('マージの途中です');
      expect(result.state, line).toBe(before);
    }
  });

  it('もう 1 つマージを始めることはできない', () => {
    expect(run(paused(), 'git merge feature').error).toContain('もう 1 つ始めることはできません');
  });

  it('決着がつく前の commit は断る', () => {
    const result = run(paused(), 'git commit -m まだ');
    expect(result.error).toContain('まだ決着のついていないファイルがあります');
    expect(result.state.merging).not.toBeNull();
  });

  it('log は読める（履歴を見て決めたいので）', () => {
    expect(run(paused(), 'git log').error).toBeUndefined();
  });
});

describe('add で決着をつける', () => {
  it('add すると、残りが減る', () => {
    const result = run(play([...CLASHING, 'git merge feature']), 'git add a.txt');

    expect(result.error).toBeUndefined();
    expect(result.state.merging?.conflicts).toEqual([]);
    expect(result.state.index).toEqual([{ path: 'a.txt', status: 'staged' }]);
    expect(result.log.join('\n')).toContain('git commit でマージを完了できます');
  });

  it('2 件のうち 1 件だけ add すると、まだ止まったまま', () => {
    const two = [
      'git init',
      'touch a.txt',
      'touch b.txt',
      'git add .',
      'git commit -m 根',
      'git switch -c feature',
      'edit a.txt',
      'edit b.txt',
      'git add .',
      'git commit -m 枝で両方',
      'git switch main',
      'edit a.txt',
      'edit b.txt',
      'git add .',
      'git commit -m 幹で両方',
      'git merge feature',
    ];
    const state = play(two);
    expect(state.merging?.conflicts).toEqual(['a.txt', 'b.txt']);

    const after = run(state, 'git add a.txt');
    expect(after.state.merging?.conflicts).toEqual(['b.txt']);
    expect(run(after.state, 'git commit').error).toContain('b.txt');
  });
});

describe('commit でマージを終える', () => {
  const resolved = () => play([...CLASHING, 'git merge feature', 'git add a.txt']);

  it('親を 2 つ持つコミットができて、止まった状態が解ける', () => {
    const result = run(resolved(), 'git commit');

    expect(result.error).toBeUndefined();
    expect(result.state.merging).toBeNull();

    const head = headCommitId(result.state) as string;
    expect(result.state.commits[head].parents).toHaveLength(2);
    expect(result.state.commits[head].message).toBe('Merge feature into main');
  });

  it('main だけが動き、feature は置いていかれる', () => {
    const before = resolved();
    const featureBefore = before.branches.find((b) => b.name === 'feature')?.target;

    const state = run(before, 'git commit').state;
    expect(state.branches.find((b) => b.name === 'feature')?.target).toBe(featureBefore);
    expect(state.branches.find((b) => b.name === 'main')?.target).toBe(headCommitId(state));
  });

  it('ステージも作業ディレクトリも片付く', () => {
    const state = run(resolved(), 'git commit').state;
    expect(state.index).toEqual([]);
    expect(state.workingDir).toEqual([]);
  });

  it('メッセージを自分で付けることもできる', () => {
    const state = run(resolved(), 'git commit -m 手で直した').state;
    const head = headCommitId(state) as string;
    expect(state.commits[head].message).toBe('手で直した');
  });

  it('終わったあとは、普通のコマンドが通る', () => {
    const state = run(resolved(), 'git commit').state;
    expect(run(state, 'git switch feature').error).toBeUndefined();
  });
});

describe('--abort でやめる', () => {
  it('マージを始める前と、そっくり同じ状態に戻る', () => {
    const before = play(CLASHING);
    const after = run(play([...CLASHING, 'git merge feature']), 'git merge --abort').state;

    // seq（採番カウンタ）以外は完全に一致する ― コミットも枝も 3 領域も動いていない
    expect({ ...after, seq: 0 }).toEqual({ ...before, seq: 0 });
  });

  it('add したあとでも戻れる', () => {
    const before = play(CLASHING);
    const after = run(
      play([...CLASHING, 'git merge feature', 'git add a.txt']),
      'git merge --abort',
    ).state;

    expect(after.merging).toBeNull();
    expect(after.index).toEqual(before.index);
    expect(after.workingDir).toEqual(before.workingDir);
  });

  it('止まっていないときの --abort は断る', () => {
    expect(run(play(CLASHING), 'git merge --abort').error).toContain('マージの途中ではありません');
  });
});

describe('決定性', () => {
  it('同じ手順を 2 回流すと、同じ状態になる', () => {
    const lines = [...CLASHING, 'git merge feature', 'git add a.txt', 'git commit'];
    expect(play(lines)).toEqual(play(lines));
  });
});
