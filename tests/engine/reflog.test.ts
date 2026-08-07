import { describe, expect, it } from 'vitest';
import {
  emptyState,
  headCommitId,
  reachableCommits,
  resolveRevision,
  run,
  type RepoState,
} from '@/lib/git-engine';

function play(lines: string[], from: RepoState = emptyState()): RepoState {
  let state = from;
  for (const line of lines) {
    const result = run(state, line);
    if (result.error) throw new Error(`「${line}」で失敗: ${result.error}`);
    state = result.state;
  }
  return state;
}

function idOf(state: RepoState, message: string): string {
  const hits = Object.values(state.commits).filter((c) => c.message === message);
  if (hits.length !== 1) throw new Error(`${message} が ${hits.length} 件あります`);
  return hits[0].id;
}

const THREE = ['git init', 'git commit -m 一', 'git commit -m 二', 'git commit -m 三'];

describe('git reflog', () => {
  it('新しい順に、HEAD@{0} から並ぶ', () => {
    const result = run(play(THREE), 'git reflog');
    expect(result.error).toBeUndefined();

    expect(result.log[0]).toContain('HEAD@{0}');
    expect(result.log[0]).toContain('三');
    expect(result.log[1]).toContain('HEAD@{1}');
    expect(result.log[1]).toContain('二');
  });

  it('HEAD が動いていなければ、そう言う', () => {
    const result = run(play(['git init']), 'git reflog');
    expect(result.log.join('\n')).toContain('まだ HEAD が動いていません');
  });

  it('状態は一切変えない', () => {
    const before = play(THREE);
    const result = run(before, 'git reflog');
    expect(result.state).toBe(before);
    expect(result.touched).toEqual([]);
  });

  it('reset や rebase も記録される', () => {
    const state = play([...THREE, 'git reset --hard HEAD~1']);
    const ops = state.reflog.map((e) => e.op);
    expect(ops).toContain('commit');
    expect(ops).toContain('reset --hard');
  });
});

describe('HEAD@{n} で時間をさかのぼる', () => {
  it('n = 0 はいまいる場所', () => {
    const state = play(THREE);
    expect(resolveRevision(state, 'HEAD@{0}')).toBe(headCommitId(state));
  });

  it('n = 1 は「1 つ前に HEAD がいた場所」', () => {
    const state = play(THREE);
    expect(resolveRevision(state, 'HEAD@{1}')).toBe(idOf(state, '二'));
    expect(resolveRevision(state, 'HEAD@{2}')).toBe(idOf(state, '一'));
  });

  it('~ とは別物 ― 親ではなく、時間をさかのぼる', () => {
    // reset で戻ったあとは、HEAD@{1} は「reset する前にいた場所」を指す。
    // 親をたどる HEAD~1 とは行き先が違う。
    const state = play([...THREE, 'git reset --hard HEAD~1']);

    expect(resolveRevision(state, 'HEAD')).toBe(idOf(state, '二'));
    expect(resolveRevision(state, 'HEAD~1')).toBe(idOf(state, '一'));
    expect(resolveRevision(state, 'HEAD@{1}')).toBe(idOf(state, '三'));
  });

  it('記録より先には行けない', () => {
    const state = play(THREE);
    expect(resolveRevision(state, 'HEAD@{99}')).toBeNull();
  });
});

describe('reset --hard からの復元', () => {
  it('切り離したコミットは、reflog に残っている', () => {
    const before = play(THREE);
    const lost = idOf(before, '三');

    const after = run(before, 'git reset --hard HEAD~1').state;
    expect(reachableCommits(after).has(lost)).toBe(false);

    const listed = run(after, 'git reflog');
    expect(listed.log.join('\n')).toContain(lost);
    expect(listed.log.join('\n')).toContain('いま辿れません');
  });

  it('id を指して reset --hard すると、そのまま戻る', () => {
    const before = play(THREE);
    const lost = idOf(before, '三');

    const state = play(['git reset --hard HEAD~1', `git reset --hard ${lost}`], before);

    expect(headCommitId(state)).toBe(lost);
    expect(reachableCommits(state).has(lost)).toBe(true);
  });

  it('HEAD@{1} でも同じところへ戻れる', () => {
    const before = play(THREE);
    const lost = idOf(before, '三');

    const state = play(['git reset --hard HEAD~1', 'git reset --hard HEAD@{1}'], before);
    expect(headCommitId(state)).toBe(lost);
  });

  it('いまの場所を残したまま、枝を生やして拾える', () => {
    const before = play(THREE);
    const lost = idOf(before, '三');
    const afterReset = run(before, 'git reset --hard HEAD~1').state;

    const state = run(afterReset, `git switch -c 救出 ${lost}`).state;

    expect(state.branches.map((b) => b.name).sort()).toEqual(['main', '救出']);
    // main は戻したまま、救出だけが失われていたコミットを指す
    expect(state.branches.find((b) => b.name === 'main')?.target).toBe(idOf(state, '二'));
    expect(state.branches.find((b) => b.name === '救出')?.target).toBe(lost);
    expect(reachableCommits(state).has(lost)).toBe(true);
  });

  it('rebase で置き去りにしたコピー元も拾える', () => {
    const before = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝1',
      'git switch main',
      'git commit -m 幹1',
      'git switch feature',
    ]);
    const original = idOf(before, '枝1');

    const after = run(before, 'git rebase main').state;
    expect(reachableCommits(after).has(original)).toBe(false);

    const rescued = run(after, `git switch -c 救出 ${original}`).state;
    expect(reachableCommits(rescued).has(original)).toBe(true);
  });
});
