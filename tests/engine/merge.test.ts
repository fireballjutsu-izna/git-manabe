import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, mergeBase, run, type RepoState } from '@/lib/git-engine';

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
  const commit = Object.values(state.commits).find((c) => c.message === message);
  if (!commit) throw new Error(`${message} というコミットがありません`);
  return commit.id;
}

/** main から feature が分かれ、両方が 1 つずつ進んだ形。 */
const DIVERGED = [
  'git init',
  'git commit -m 根',
  'git checkout -b feature',
  'git commit -m 枝の上',
  'git switch main',
  'git commit -m 幹の上',
];

describe('fast-forward', () => {
  it('コミットは増えず、枝が前へ滑るだけ', () => {
    const before = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
    ]);
    const countBefore = Object.keys(before.commits).length;

    const result = run(before, 'git merge feature');
    expect(result.error).toBeUndefined();

    // 新しいコミットは作られない
    expect(Object.keys(result.state.commits)).toHaveLength(countBefore);
    // main が feature に追いついた
    const main = result.state.branches.find((b) => b.name === 'main');
    const feature = result.state.branches.find((b) => b.name === 'feature');
    expect(main?.target).toBe(feature?.target);
    expect(result.log.join('\n')).toContain('マージコミットは作られていません');
  });

  it('取り込んだぶんのファイルが tracked になる', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'touch app.ts',
      'git add .',
      'git commit -m 枝の上',
      'git switch main',
      'git merge feature',
    ]);
    expect(state.tracked).toContain('app.ts');
  });
});

describe('3-way マージ', () => {
  it('親を 2 つ持つコミットが生まれる', () => {
    const before = play(DIVERGED);
    const result = run(before, 'git merge feature');
    expect(result.error).toBeUndefined();

    const head = headCommitId(result.state) as string;
    const mergeCommit = result.state.commits[head];

    expect(mergeCommit.parents).toHaveLength(2);
    expect(mergeCommit.parents).toContain(idOf(before, '幹の上'));
    expect(mergeCommit.parents).toContain(idOf(before, '枝の上'));
    expect(mergeCommit.message).toBe("Merge branch 'feature'");
  });

  it('main だけが動き、feature は置いていかれる', () => {
    const before = play(DIVERGED);
    const featureBefore = before.branches.find((b) => b.name === 'feature')?.target;

    const state = run(before, 'git merge feature').state;
    expect(state.branches.find((b) => b.name === 'feature')?.target).toBe(featureBefore);
    expect(state.branches.find((b) => b.name === 'main')?.target).toBe(headCommitId(state));
  });

  it('分岐点を正しく見つける', () => {
    const state = play(DIVERGED);
    const base = mergeBase(state, idOf(state, '幹の上'), idOf(state, '枝の上'));
    expect(base).toBe(idOf(state, '根'));
  });

  it('マージ後は両側のファイルが tracked になる', () => {
    const state = play([
      'git init',
      'touch base.txt',
      'git add .',
      'git commit -m 根',
      'git checkout -b feature',
      'touch app.ts',
      'git add .',
      'git commit -m 枝の上',
      'git switch main',
      'touch readme.md',
      'git add .',
      'git commit -m 幹の上',
      'git merge feature',
    ]);
    expect([...state.tracked].sort()).toEqual(['app.ts', 'base.txt', 'readme.md']);
  });

  it('detached HEAD では断る', () => {
    // 分岐している側（幹の先端）で HEAD を外す。
    // 根で外すと feature は fast-forward になってしまい、3-way に入らない。
    const before = play(DIVERGED);
    const tip = idOf(before, '幹の上');
    const result = last([...DIVERGED, `git checkout ${tip}`, 'git merge feature']);
    expect(result.error).toContain('detached HEAD ではマージできません');
  });

  it('detached HEAD でも fast-forward はできる', () => {
    // 分岐していなければマージコミットは要らないので、受け取る枝も要らない。
    const before = play(DIVERGED);
    const root = idOf(before, '根');
    const result = last([...DIVERGED, `git checkout ${root}`, 'git merge feature']);

    expect(result.error).toBeUndefined();
    expect(result.state.head).toEqual({ type: 'detached', oid: idOf(before, '枝の上') });
  });
});

describe('取り込むものが無いとき', () => {
  it('すでに祖先なら、何も変えずに済ませる', () => {
    const before = play([
      'git init',
      'git commit -m 根',
      'git branch feature',
      'git commit -m 幹の上',
    ]);
    const result = run(before, 'git merge feature');

    expect(result.error).toBeUndefined();
    expect(result.state).toBe(before);
    expect(result.touched).toEqual([]);
    expect(result.log.join('\n')).toContain('すでに取り込まれています');
  });

  it('自分自身は断る', () => {
    expect(last(['git init', 'git commit -m 根', 'git merge main']).error).toContain(
      'いまいるコミットそのもの',
    );
  });

  it('無い枝は断り、状態を変えない', () => {
    const before = play(['git init', 'git commit -m 根']);
    const result = run(before, 'git merge nope');
    expect(result.error).toContain('ありません');
    expect(result.state).toBe(before);
  });

  it('コミットが無いうちは断る', () => {
    expect(last(['git init', 'git merge main']).error).toContain('まだコミットが 1 つもない');
  });
});
