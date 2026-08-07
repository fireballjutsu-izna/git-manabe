import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, resolveRevision, run, type RepoState } from '@/lib/git-engine';

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
  const commit = Object.values(state.commits).find((c) => c.message === message);
  if (!commit) throw new Error(`${message} というコミットがありません`);
  return commit.id;
}

/** a.txt を含む 1 つ目、b.txt を含む 2 つ目。2 つ目を取り消すのが以下の題材。 */
const TWO_COMMITS = [
  'git init',
  'touch a.txt',
  'git add .',
  'git commit -m 一つ目',
  'touch b.txt',
  'git add .',
  'git commit -m 二つ目',
];

describe('3 つのモードで共通のこと', () => {
  it('どのモードでも、枝は同じだけ動く', () => {
    const before = play(TWO_COMMITS);
    const first = idOf(before, '一つ目');

    for (const mode of ['--soft', '--mixed', '--hard']) {
      const after = run(before, `git reset ${mode} HEAD~1`).state;
      expect(headCommitId(after), mode).toBe(first);
      expect(after.branches.find((b) => b.name === 'main')?.target, mode).toBe(first);
    }
  });

  it('どのモードでも、コミット自体は消えない', () => {
    const before = play(TWO_COMMITS);
    for (const mode of ['--soft', '--mixed', '--hard']) {
      const after = run(before, `git reset ${mode} HEAD~1`).state;
      expect(Object.keys(after.commits), mode).toHaveLength(2);
    }
  });

  it('どのモードでも HEAD が touched に入る', () => {
    const before = play(TWO_COMMITS);
    for (const mode of ['--soft', '--mixed', '--hard']) {
      expect(run(before, `git reset ${mode} HEAD~1`).touched, mode).toContain('head');
    }
  });
});

describe('--soft', () => {
  it('取り消したぶんがステージに残る', () => {
    const result = run(play(TWO_COMMITS), 'git reset --soft HEAD~1');

    expect(result.state.index.map((f) => f.path)).toEqual(['b.txt']);
    expect(result.state.index[0].status).toBe('staged');
    expect(result.state.workingDir).toEqual([]);
  });

  it('作業ディレクトリには触らない', () => {
    const before = play([...TWO_COMMITS, 'touch c.txt']);
    const result = run(before, 'git reset --soft HEAD~1');

    expect(result.state.workingDir.map((f) => f.path)).toEqual(['c.txt']);
    expect(result.touched).not.toContain('workingDir');
  });

  it('すぐコミットし直せる', () => {
    const state = play([...TWO_COMMITS, 'git reset --soft HEAD~1', 'git commit -m やり直し']);
    const head = headCommitId(state) as string;
    expect(state.commits[head].message).toBe('やり直し');
    expect(state.commits[head].paths).toEqual(['b.txt']);
  });
});

describe('--mixed（既定）', () => {
  it('取り消したぶんが、ステージされていない変更に落ちる', () => {
    const result = run(play(TWO_COMMITS), 'git reset --mixed HEAD~1');

    expect(result.state.index).toEqual([]);
    expect(result.state.workingDir.map((f) => f.path)).toEqual(['b.txt']);
    // 戻した先ではまだ知られていないファイルなので untracked
    expect(result.state.workingDir[0].status).toBe('untracked');
    expect(result.touched).toEqual(['head', 'index', 'workingDir']);
  });

  it('モードを書かなければ --mixed になる', () => {
    const before = play(TWO_COMMITS);
    expect(run(before, 'git reset HEAD~1').state).toEqual(
      run(before, 'git reset --mixed HEAD~1').state,
    );
  });

  it('引数なしの git reset はステージを空にするだけ', () => {
    const before = play([...TWO_COMMITS, 'touch c.txt', 'git add .']);
    expect(before.index.map((f) => f.path)).toEqual(['c.txt']);

    const result = run(before, 'git reset');
    expect(result.state.index).toEqual([]);
    expect(result.state.workingDir.map((f) => f.path)).toEqual(['c.txt']);
    expect(headCommitId(result.state)).toBe(headCommitId(before));
  });

  it('コミット済みのファイルへの変更は modified として戻る', () => {
    // a.txt を 2 回コミットしてから、2 回目を取り消す
    const state = play([
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m 一つ目',
      'edit a.txt',
      'git add .',
      'git commit -m 二つ目',
      'git reset HEAD~1',
    ]);
    expect(state.workingDir).toEqual([{ path: 'a.txt', status: 'modified' }]);
  });
});

describe('--hard', () => {
  it('ステージも作業ディレクトリも空にする', () => {
    const before = play([...TWO_COMMITS, 'touch c.txt', 'touch d.txt', 'git add d.txt']);
    const result = run(before, 'git reset --hard HEAD~1');

    expect(result.state.index).toEqual([]);
    expect(result.state.workingDir).toEqual([]);
    expect(result.log.join('\n')).toContain('reflog を使っても戻せません');
  });

  it('取り消したコミットのファイルは tracked から外れる', () => {
    const before = play(TWO_COMMITS);
    expect(before.tracked).toContain('b.txt');

    const after = run(before, 'git reset --hard HEAD~1').state;
    expect(after.tracked).toEqual(['a.txt']);
  });
});

describe('行き先の書き方', () => {
  it('HEAD~n と ^ で祖先をたどれる', () => {
    const state = play(['git init', 'git commit -m 一', 'git commit -m 二', 'git commit -m 三']);

    expect(resolveRevision(state, 'HEAD')).toBe(idOf(state, '三'));
    expect(resolveRevision(state, 'HEAD~1')).toBe(idOf(state, '二'));
    expect(resolveRevision(state, 'HEAD^')).toBe(idOf(state, '二'));
    expect(resolveRevision(state, 'HEAD~2')).toBe(idOf(state, '一'));
    expect(resolveRevision(state, 'HEAD^^')).toBe(idOf(state, '一'));
    expect(resolveRevision(state, 'main~2')).toBe(idOf(state, '一'));
    // 根より先には行けない
    expect(resolveRevision(state, 'HEAD~3')).toBeNull();
  });

  it('根を越える指定は、状態を変えずに断る', () => {
    const before = play(['git init', 'git commit -m 一']);
    const result = run(before, 'git reset --hard HEAD~5');

    expect(result.error).toContain('見つかりません');
    expect(result.state).toBe(before);
    expect(result.touched).toEqual([]);
  });

  it('モードを 2 つ並べたら断る', () => {
    const before = play(TWO_COMMITS);
    const result = run(before, 'git reset --soft --hard HEAD~1');
    expect(result.error).toContain('同時に指定できません');
    expect(result.state).toBe(before);
  });
});

describe('detached HEAD での reset', () => {
  it('枝は動かず、HEAD だけが動く', () => {
    const base = play(TWO_COMMITS);
    const mainBefore = base.branches.find((b) => b.name === 'main')?.target;
    const tip = headCommitId(base) as string;

    const state = play([`git checkout ${tip}`, 'git reset --hard HEAD~1'], base);

    expect(state.branches.find((b) => b.name === 'main')?.target).toBe(mainBefore);
    expect(state.head).toEqual({ type: 'detached', oid: idOf(state, '一つ目') });
  });
});
