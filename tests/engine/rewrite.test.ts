import { describe, expect, it } from 'vitest';
import {
  emptyState,
  headCommitId,
  reachableCommits,
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

function last(lines: string[]) {
  return run(play(lines.slice(0, -1)), lines[lines.length - 1]);
}

function idOf(state: RepoState, message: string): string {
  const hits = Object.values(state.commits).filter((c) => c.message === message);
  if (hits.length === 0) throw new Error(`${message} というコミットがありません`);
  if (hits.length > 1) throw new Error(`${message} が ${hits.length} 件あります`);
  return hits[0].id;
}

/** 第一親をたどって、HEAD からのメッセージ列を古い順に返す。 */
function chain(state: RepoState): string[] {
  const out: string[] = [];
  let cursor = headCommitId(state);
  while (cursor) {
    const commit = state.commits[cursor];
    if (!commit) break;
    out.push(commit.message);
    cursor = commit.parents[0] ?? null;
  }
  return out.reverse();
}

/** main から feature が分かれ、feature に 2 つ積んだ形。 */
const DIVERGED = [
  'git init',
  'git commit -m 根',
  'git checkout -b feature',
  'git commit -m 枝1',
  'git commit -m 枝2',
  'git switch main',
  'git commit -m 幹1',
  'git switch feature',
];

describe('rebase', () => {
  it('コミットがコピーされ、id が変わる', () => {
    const before = play(DIVERGED);
    const oldFirst = idOf(before, '枝1');
    const oldSecond = idOf(before, '枝2');

    const result = run(before, 'git rebase main');
    expect(result.error).toBeUndefined();

    // 元の 2 つはそのまま残り、コピーが 2 つ増える
    expect(Object.keys(result.state.commits)).toHaveLength(6);
    expect(result.state.commits[oldFirst]).toBeDefined();
    expect(result.state.commits[oldSecond]).toBeDefined();

    // feature は新しいコピーの先端を指す
    const tip = headCommitId(result.state) as string;
    expect(tip).not.toBe(oldSecond);
    expect(result.state.commits[tip].message).toBe('枝2');
  });

  it('置き直したあとは、幹の上に一直線に並ぶ', () => {
    const state = play([...DIVERGED, 'git rebase main']);
    expect(chain(state)).toEqual(['根', '幹1', '枝1', '枝2']);
  });

  it('コピー元は、どの枝からも辿れなくなる', () => {
    const before = play(DIVERGED);
    const oldSecond = idOf(before, '枝2');
    expect(reachableCommits(before).has(oldSecond)).toBe(true);

    const after = run(before, 'git rebase main').state;
    expect(reachableCommits(after).has(oldSecond)).toBe(false);
    // 消えてはいない
    expect(after.commits[oldSecond]).toBeDefined();
  });

  it('中身（paths）はコピーされる', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'touch app.ts',
      'git add .',
      'git commit -m 枝1',
      'git switch main',
      'git commit -m 幹1',
      'git switch feature',
      'git rebase main',
    ]);
    const tip = headCommitId(state) as string;
    expect(state.commits[tip].paths).toEqual(['app.ts']);
    expect(state.tracked).toContain('app.ts');
  });

  it('分かれていなければ fast-forward で、コピーは起きない', () => {
    const before = play([
      'git init',
      'git commit -m 根',
      'git branch feature',
      'git commit -m 幹1',
      'git switch feature',
    ]);
    const result = run(before, 'git rebase main');

    expect(Object.keys(result.state.commits)).toHaveLength(2);
    expect(result.log.join('\n')).toContain('id はそのまま');
  });

  it('すでにその上にいれば、何も変えない', () => {
    const before = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝1',
    ]);
    const result = run(before, 'git rebase main');

    expect(result.error).toBeUndefined();
    expect(result.state).toBe(before);
    expect(result.touched).toEqual([]);
  });

  it('無い行き先は、状態を変えずに断る', () => {
    const before = play(DIVERGED);
    const result = run(before, 'git rebase nope');
    expect(result.error).toContain('ありません');
    expect(result.state).toBe(before);
  });

  it('置き直しても id は決定的', () => {
    expect(play([...DIVERGED, 'git rebase main'])).toEqual(
      play([...DIVERGED, 'git rebase main']),
    );
  });
});

describe('cherry-pick', () => {
  it('指定したコミットだけがコピーされる', () => {
    const before = play(DIVERGED);
    const target = idOf(before, '枝1');
    const state = play(['git switch main', `git cherry-pick ${target}`], before);

    expect(chain(state)).toEqual(['根', '幹1', '枝1']);
    // 元も残っている ＝ 同じメッセージのコミットが 2 つ
    expect(Object.values(state.commits).filter((c) => c.message === '枝1')).toHaveLength(2);
  });

  it('複数を指定した順に積む', () => {
    const before = play(DIVERGED);
    const a = idOf(before, '枝1');
    const b = idOf(before, '枝2');
    const state = play(['git switch main', `git cherry-pick ${a} ${b}`], before);
    expect(chain(state)).toEqual(['根', '幹1', '枝1', '枝2']);
  });

  it('1 つでも解決できなければ、1 つも積まない', () => {
    const before = play(DIVERGED);
    const a = idOf(before, '枝1');
    const onMain = play(['git switch main'], before);

    const result = run(onMain, `git cherry-pick ${a} nope`);
    expect(result.error).toContain('ありません');
    expect(result.state).toBe(onMain);
  });

  it('マージコミットは断る', () => {
    const merged = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝1',
      'git switch main',
      'git commit -m 幹1',
      'git merge feature',
    ]);
    const mergeId = headCommitId(merged) as string;
    const result = run(merged, `git cherry-pick ${mergeId}`);
    expect(result.error).toContain('マージコミットです');
  });
});

describe('revert', () => {
  it('打ち消すコミットが前に足され、履歴は減らない', () => {
    const before = play(['git init', 'git commit -m 一', 'git commit -m 二']);
    const result = run(before, 'git revert HEAD');

    expect(result.error).toBeUndefined();
    expect(Object.keys(result.state.commits)).toHaveLength(3);
    expect(chain(result.state)).toEqual(['一', '二', 'Revert "二"']);
  });

  it('reset と違って、元のコミットは辿れたまま', () => {
    const before = play(['git init', 'git commit -m 一', 'git commit -m 二']);
    const second = idOf(before, '二');

    const reverted = run(before, 'git revert HEAD').state;
    expect(reachableCommits(reverted).has(second)).toBe(true);

    // 同じことを reset でやると、辿れなくなる
    const reset = run(before, 'git reset --hard HEAD~1').state;
    expect(reachableCommits(reset).has(second)).toBe(false);
  });

  it('打ち消したコミットのパスを引き継ぐ', () => {
    const state = play([
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m 追加',
      'git revert HEAD',
    ]);
    const tip = headCommitId(state) as string;
    expect(state.commits[tip].paths).toEqual(['a.txt']);
  });

  it('マージコミットは断る', () => {
    const merged = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝1',
      'git switch main',
      'git commit -m 幹1',
      'git merge feature',
    ]);
    expect(run(merged, 'git revert HEAD').error).toContain('マージコミットです');
  });
});

describe('stash', () => {
  const DIRTY = ['git init', 'git commit -m 根', 'touch a.txt', 'touch b.txt', 'git add a.txt'];

  it('3 領域だけが動き、グラフは変わらない', () => {
    const before = play(DIRTY);
    const result = run(before, 'git stash');

    expect(result.state.index).toEqual([]);
    expect(result.state.workingDir).toEqual([]);
    expect(result.state.stash).toHaveLength(1);
    expect(result.touched).toEqual(['workingDir', 'index']);

    // コミットも枝も HEAD も動いていない
    expect(result.state.commits).toEqual(before.commits);
    expect(result.state.branches).toEqual(before.branches);
    expect(result.state.head).toEqual(before.head);
  });

  it('pop で、ステージと作業ディレクトリの区別ごと戻る', () => {
    const state = play([...DIRTY, 'git stash', 'git stash pop']);

    expect(state.index.map((f) => f.path)).toEqual(['a.txt']);
    expect(state.workingDir.map((f) => f.path)).toEqual(['b.txt']);
    expect(state.stash).toEqual([]);
  });

  it('apply では一覧に残る', () => {
    const state = play([...DIRTY, 'git stash', 'git stash apply']);
    expect(state.stash).toHaveLength(1);
    expect(state.index.map((f) => f.path)).toEqual(['a.txt']);
  });

  it('後入れ先出しで戻る', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'touch one.txt',
      'git stash -m 一つ目',
      'touch two.txt',
      'git stash -m 二つ目',
    ]);
    expect(state.stash.map((e) => e.message)).toEqual(['一つ目', '二つ目']);

    const popped = run(state, 'git stash pop').state;
    expect(popped.workingDir.map((f) => f.path)).toEqual(['two.txt']);
    expect(popped.stash.map((e) => e.message)).toEqual(['一つ目']);
  });

  it('退避するものが無ければ、エラーにはせず知らせるだけ', () => {
    const before = play(['git init', 'git commit -m 根']);
    const result = run(before, 'git stash');
    expect(result.error).toBeUndefined();
    expect(result.state).toBe(before);
    expect(result.log.join('\n')).toContain('退避するものがありません');
  });

  it('空の状態で pop すると断る', () => {
    expect(last(['git init', 'git commit -m 根', 'git stash pop']).error).toContain(
      '退避したものがありません',
    );
  });

  it('list は新しいものを stash@{0} として出す', () => {
    const result = last([
      'git init',
      'git commit -m 根',
      'touch one.txt',
      'git stash -m 一つ目',
      'touch two.txt',
      'git stash -m 二つ目',
      'git stash list',
    ]);
    expect(result.log[0]).toContain('stash@{0}: 二つ目');
    expect(result.log[1]).toContain('stash@{1}: 一つ目');
  });

  it('知らない下位コマンドは、使えるものを添えて断る', () => {
    const result = last(['git init', 'git commit -m 根', 'git stash frobnicate']);
    expect(result.error).toContain('扱えません');
    expect(result.log.join('\n')).toContain('push / pop / apply / list / drop');
  });
});
