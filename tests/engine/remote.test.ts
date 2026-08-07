import { describe, expect, it } from 'vitest';
import { emptyState, findRemote, headCommitId, run, type RepoState } from '@/lib/git-engine';

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

const tracking = (state: RepoState, name: string): string | undefined =>
  state.remoteBranches.find((r) => r.name === name)?.target;

const localTip = (state: RepoState, name: string): string | undefined =>
  state.branches.find((b) => b.name === name)?.target;

/** リモートを登録し、1 回 push まで済ませた形。 */
const PUSHED = [
  'git init',
  'touch a.txt',
  'git add .',
  'git commit -m 一つ目',
  'git remote add origin https://example.com/x.git',
  'git push origin main',
];

describe('git remote add', () => {
  it('登録するだけで、まだ何も送らない', () => {
    const state = play([
      'git init',
      'git commit -m 一つ目',
      'git remote add origin https://example.com/x.git',
    ]);

    expect(state.remotes).toHaveLength(1);
    expect(state.remotes[0].name).toBe('origin');
    // 向こうはまだ空
    expect(state.remotes[0].branches).toEqual([]);
    expect(Object.keys(state.remotes[0].commits)).toEqual([]);
    expect(state.remoteBranches).toEqual([]);
  });

  it('同じ名前は 2 度登録できない', () => {
    expect(
      last(['git init', 'git remote add origin a', 'git remote add origin b']).error,
    ).toContain('すでにあります');
  });
});

describe('git push', () => {
  it('向こうに枝ができ、追跡ブランチも動く', () => {
    const state = play(PUSHED);

    const origin = findRemote(state, 'origin')!;
    expect(origin.branches.map((b) => b.name)).toEqual(['main']);
    expect(origin.branches[0].target).toBe(localTip(state, 'main'));
    expect(Object.keys(origin.commits)).toHaveLength(1);
    expect(tracking(state, 'origin/main')).toBe(localTip(state, 'main'));
  });

  it('2 回目は差分だけを送る', () => {
    const result = last([...PUSHED, 'git commit -m 二つ目', 'git push origin main']);
    expect(result.log[0]).toContain('1 件を');
    expect(Object.keys(findRemote(result.state, 'origin')!.commits)).toHaveLength(2);
  });

  it('送るものが無ければ、そう言って何もしない', () => {
    const before = play(PUSHED);
    const result = run(before, 'git push origin main');
    expect(result.error).toBeUndefined();
    expect(result.state).toBe(before);
    expect(result.log.join('\n')).toContain('すでに同じところ');
  });

  it('早送りにならない push は断る', () => {
    // 同僚が向こうを進めたあと、こちらも別に進めてから送る
    const state = play([...PUSHED, 'teammate 1', 'git commit -m 手元の変更']);
    const result = run(state, 'git push origin main');

    expect(result.error).toContain('あなたが持っていないコミットがあります');
    expect(result.log.join('\n')).toContain('git pull');
    expect(result.state).toBe(state);
  });

  it('detached HEAD では断る', () => {
    const base = play(PUSHED);
    const tip = headCommitId(base) as string;
    expect(last([...PUSHED, `git checkout ${tip}`, 'git push origin']).error).toContain(
      'detached HEAD では push できません',
    );
  });
});

describe('teammate（このサイト独自）', () => {
  it('向こうだけが進み、こちらのグラフは変わらない', () => {
    const before = play(PUSHED);
    const result = run(before, 'teammate 2');

    // 手元のコミットは増えていない
    expect(Object.keys(result.state.commits)).toEqual(Object.keys(before.commits));
    expect(result.state.branches).toEqual(before.branches);
    expect(result.state.remoteBranches).toEqual(before.remoteBranches);
    expect(result.touched).toEqual([]);

    // 向こうだけが増えている
    expect(Object.keys(findRemote(result.state, 'origin')!.commits)).toHaveLength(3);
  });

  it('push していない枝には積めない', () => {
    const result = last([
      'git init',
      'git commit -m 一つ目',
      'git remote add origin x',
      'teammate 1',
    ]);
    expect(result.error).toContain('がまだありません');
  });

  it('リモートの id は、手元のものとぶつからない', () => {
    const state = play([...PUSHED, 'teammate 3']);
    const origin = findRemote(state, 'origin')!;
    const localIds = new Set(Object.keys(state.commits));
    const newOnes = Object.keys(origin.commits).filter((id) => !localIds.has(id));

    expect(newOnes).toHaveLength(3);
    expect(new Set(newOnes).size).toBe(3);
  });
});

describe('git fetch', () => {
  it('コミットは持ってくるが、手元の枝は動かさない', () => {
    const before = play([...PUSHED, 'teammate 2']);
    const mainBefore = localTip(before, 'main');

    const result = run(before, 'git fetch origin');
    expect(result.error).toBeUndefined();

    // コミットは増えた
    expect(Object.keys(result.state.commits)).toHaveLength(3);
    // 追跡ブランチは動いた
    expect(tracking(result.state, 'origin/main')).not.toBe(mainBefore);
    // 手元の枝と HEAD は動いていない ― ここが fetch の要点
    expect(localTip(result.state, 'main')).toBe(mainBefore);
    expect(headCommitId(result.state)).toBe(mainBefore);
    expect(result.log.join('\n')).toContain('あなたの枝は 1 つも動いていません');
  });

  it('fetch しただけのコミットは、迷子扱いにしない', async () => {
    const { reachableCommits } = await import('@/lib/git-engine');
    const state = play([...PUSHED, 'teammate 1', 'git fetch origin']);
    const reachable = reachableCommits(state);

    // origin/main から辿れるので、全部が到達可能
    expect([...Object.keys(state.commits)].every((id) => reachable.has(id))).toBe(true);
  });

  it('新しいものが無ければ、そう言う', () => {
    const result = last([...PUSHED, 'git fetch origin']);
    expect(result.log.join('\n')).toContain('新しいものはありませんでした');
  });
});

describe('git pull', () => {
  it('fetch と merge をまとめて行う', () => {
    const before = play([...PUSHED, 'teammate 2']);
    const mainBefore = localTip(before, 'main');

    const result = run(before, 'git pull origin main');
    expect(result.error).toBeUndefined();

    // 今度は手元の枝も動く
    expect(localTip(result.state, 'main')).not.toBe(mainBefore);
    expect(localTip(result.state, 'main')).toBe(tracking(result.state, 'origin/main'));
    expect(result.log[0]).toContain('git fetch');
    expect(result.log[0]).toContain('git merge');
  });

  it('分かれていなければ fast-forward で、マージコミットは作られない', () => {
    const state = play([...PUSHED, 'teammate 2', 'git pull origin main']);
    expect(Object.keys(state.commits)).toHaveLength(3);
    expect(Object.values(state.commits).every((c) => c.parents.length <= 1)).toBe(true);
  });

  it('両方が進んでいたら、マージコミットができる', () => {
    const state = play([
      ...PUSHED,
      'teammate 1',
      'git commit -m 手元の変更',
      'git pull origin main',
    ]);

    const tip = localTip(state, 'main') as string;
    expect(state.commits[tip].parents).toHaveLength(2);
  });

  it('pull のあとなら push が通る', () => {
    const state = play([
      ...PUSHED,
      'teammate 1',
      'git commit -m 手元の変更',
      'git pull origin main',
    ]);
    const result = run(state, 'git push origin main');

    expect(result.error).toBeUndefined();
    expect(tracking(result.state, 'origin/main')).toBe(localTip(result.state, 'main'));
  });

  it('向こうに無い枝は断る', () => {
    expect(last([...PUSHED, 'git switch -c feature', 'git pull origin feature']).error).toContain(
      'がありません',
    );
  });
});

describe('リモートを消す', () => {
  it('追跡ブランチも一緒に消える', () => {
    const state = play([...PUSHED, 'git remote remove origin']);
    expect(state.remotes).toEqual([]);
    expect(state.remoteBranches).toEqual([]);
    // コミットは残る
    expect(Object.keys(state.commits)).toHaveLength(1);
  });
});

describe('決定性', () => {
  it('リモートを含めても、同じコマンド列からは同じ状態が出る', () => {
    const lines = [...PUSHED, 'teammate 2', 'git fetch origin', 'git pull origin main'];
    expect(play(lines)).toEqual(play(lines));
  });
});
