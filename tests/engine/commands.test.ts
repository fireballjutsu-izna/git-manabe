import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, run } from '@/lib/git-engine';
import type { CommandResult, RepoState } from '@/lib/git-engine';

/** コマンド列をまとめて流す。1 つでも失敗したら、その場で分かるようにする。 */
function play(lines: string[], from: RepoState = emptyState()): RepoState {
  let state = from;
  for (const line of lines) {
    const result = run(state, line);
    if (result.error) throw new Error(`「${line}」で失敗: ${result.error}`);
    state = result.state;
  }
  return state;
}

/** 最後の 1 行だけ結果を見たいとき。 */
function last(lines: string[]): CommandResult {
  const head = lines.slice(0, -1);
  return run(play(head), lines[lines.length - 1]);
}

describe('git init', () => {
  it('直後は unborn ― main という枝はまだ無い', () => {
    const state = play(['git init']);
    expect(state.initialized).toBe(true);
    expect(state.branches).toEqual([]);
    expect(state.head).toEqual({ type: 'branch', ref: 'main' });
    expect(headCommitId(state)).toBeNull();
  });

  it('2 回目は断る', () => {
    expect(last(['git init', 'git init']).error).toContain('すでにリポジトリがあります');
  });

  it('init の前は、ほとんどのコマンドが断られる', () => {
    for (const line of ['git commit -m x', 'git branch f', 'git status', 'touch a.txt']) {
      const result = run(emptyState(), line);
      expect(result.error, line).toContain('リポジトリではありません');
      expect(result.touched, line).toEqual([]);
    }
  });
});

describe('git commit', () => {
  it('最初のコミットが main を生む', () => {
    const state = play(['git init', 'git commit -m "はじめ"']);
    expect(state.branches).toHaveLength(1);
    expect(state.branches[0].name).toBe('main');
    expect(state.branches[0].target).toBe(headCommitId(state));
  });

  it('3 回積むと 1 本の鎖になり、reflog も 3 件たまる', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git commit -m two',
      'git commit -m three',
    ]);

    const ids = Object.keys(state.commits);
    expect(ids).toHaveLength(3);

    const tip = headCommitId(state) as string;
    expect(state.commits[tip].message).toBe('three');
    const mid = state.commits[tip].parents[0];
    expect(state.commits[mid].message).toBe('two');
    const root = state.commits[mid].parents[0];
    expect(state.commits[root].message).toBe('one');
    expect(state.commits[root].parents).toEqual([]);

    expect(state.reflog.filter((e) => e.op === 'commit')).toHaveLength(3);
  });

  it('メッセージが無ければ断る', () => {
    expect(last(['git init', 'git commit']).error).toContain('コミットメッセージ');
  });

  it('-m は引用符が無くても、残り全部をメッセージにする', () => {
    const state = play(['git init', 'git commit -m 最初の コミット です']);
    const tip = headCommitId(state) as string;
    expect(state.commits[tip].message).toBe('最初の コミット です');
  });

  it('ステージが空なら、変更を 1 つ作って進む', () => {
    const result = last(['git init', 'git commit -m auto']);
    expect(result.error).toBeUndefined();
    expect(result.log.join('\n')).toContain('ステージが空だった');
    expect(result.state.tracked).toHaveLength(1);
  });
});

describe('3 領域の行き来', () => {
  it('touch → add → commit で、領域が順に移る', () => {
    let state = play(['git init']);

    const touched = run(state, 'touch hello.txt');
    expect(touched.touched).toEqual(['workingDir']);
    expect(touched.state.workingDir).toEqual([{ path: 'hello.txt', status: 'untracked' }]);
    expect(touched.state.index).toEqual([]);
    state = touched.state;

    const added = run(state, 'git add hello.txt');
    expect(added.touched).toEqual(['workingDir', 'index']);
    expect(added.state.workingDir).toEqual([]);
    expect(added.state.index).toEqual([{ path: 'hello.txt', status: 'staged' }]);
    state = added.state;

    const committed = run(state, 'git commit -m "追加"');
    expect(committed.touched).toEqual(['index', 'repo', 'head']);
    expect(committed.state.index).toEqual([]);
    expect(committed.state.tracked).toEqual(['hello.txt']);
    expect(committed.log.join('\n')).not.toContain('ステージが空だった');
  });

  it('git add . はまとめてステージへ移す', () => {
    const state = play(['git init', 'touch a.txt', 'touch b.txt', 'git add .']);
    expect(state.workingDir).toEqual([]);
    expect(state.index.map((f) => f.path)).toEqual(['a.txt', 'b.txt']);
  });

  it('コミット済みのファイルは untracked ではなく modified になる', () => {
    const state = play([
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m "追加"',
      'edit a.txt',
    ]);
    expect(state.workingDir).toEqual([{ path: 'a.txt', status: 'modified' }]);
  });

  it('コミットしていないファイルは edit できない', () => {
    expect(last(['git init', 'touch a.txt', 'edit a.txt']).error).toContain(
      'まだ一度もコミットされていません',
    );
  });

  it('同じ名前の touch は断る', () => {
    expect(last(['git init', 'touch a.txt', 'touch a.txt']).error).toContain('もうあります');
  });
});

describe('git branch', () => {
  it('枝を作っても HEAD は動かない', () => {
    const before = play(['git init', 'git commit -m one']);
    const after = run(before, 'git branch feature');

    expect(after.state.branches.map((b) => b.name).sort()).toEqual(['feature', 'main']);
    expect(after.state.head).toEqual(before.head);
    expect(after.touched).toEqual(['repo']);
    expect(after.log.join('\n')).toContain('HEAD は動いていません');
  });

  it('コミットが無いうちは枝を作れない', () => {
    expect(last(['git init', 'git branch feature']).error).toContain('まだコミットが 1 つもない');
  });

  it('同じ名前は 2 度作れない', () => {
    expect(last(['git init', 'git commit -m one', 'git branch f', 'git branch f']).error).toContain(
      'すでにあります',
    );
  });

  it('いる枝は消せない', () => {
    expect(last(['git init', 'git commit -m one', 'git branch -d main']).error).toContain(
      'この枝は消せません',
    );
  });

  it('消してもコミットは残る', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git branch feature',
      'git branch -d feature',
    ]);
    expect(state.branches.map((b) => b.name)).toEqual(['main']);
    expect(Object.keys(state.commits)).toHaveLength(1);
  });

  it('使えない名前は断る', () => {
    expect(last(['git init', 'git commit -m one', 'git branch HEAD']).error).toContain('HEAD は');
  });
});

describe('git switch / checkout', () => {
  it('枝の上でコミットすると、その枝だけが伸びる', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git branch feature',
      'git switch feature',
      'git commit -m two',
    ]);

    const main = state.branches.find((b) => b.name === 'main');
    const feature = state.branches.find((b) => b.name === 'feature');

    expect(feature?.target).toBe(headCommitId(state));
    expect(main?.target).not.toBe(feature?.target);
    expect(state.commits[feature!.target].parents).toEqual([main!.target]);
  });

  it('コミットを直接 checkout すると detached HEAD になる', () => {
    const base = play(['git init', 'git commit -m one', 'git commit -m two']);
    const root = Object.values(base.commits).find((c) => c.parents.length === 0)!;

    const result = run(base, `git checkout ${root.id}`);
    expect(result.error).toBeUndefined();
    expect(result.state.head).toEqual({ type: 'detached', oid: root.id });
    expect(result.touched).toEqual(['head']);
    expect(result.log.join('\n')).toContain('detached HEAD');
  });

  it('switch は枝しか受け取らない', () => {
    const base = play(['git init', 'git commit -m one']);
    const id = headCommitId(base) as string;

    const denied = run(base, `git switch ${id}`);
    expect(denied.error).toContain('switch は枝にしか移れません');

    const allowed = run(base, `git switch --detach ${id}`);
    expect(allowed.error).toBeUndefined();
    expect(allowed.state.head).toEqual({ type: 'detached', oid: id });
  });

  it('detached HEAD でコミットしても、どの枝も動かない', () => {
    const base = play(['git init', 'git commit -m one', 'git commit -m two']);
    const root = Object.values(base.commits).find((c) => c.parents.length === 0)!;
    const branchesBefore = base.branches;

    const state = play([`git checkout ${root.id}`, 'git commit -m 迷子'], base);

    expect(state.branches).toEqual(branchesBefore);
    expect(state.head.type).toBe('detached');
    expect(state.commits[headCommitId(state) as string].message).toBe('迷子');
  });

  it('短縮した id でも引ける', () => {
    const base = play(['git init', 'git commit -m one']);
    const id = headCommitId(base) as string;
    const result = run(base, `git checkout ${id.slice(0, 4)}`);
    expect(result.error).toBeUndefined();
    expect(result.state.head).toEqual({ type: 'detached', oid: id });
  });

  it('checkout -b は枝を作って移る', () => {
    const state = play(['git init', 'git commit -m one', 'git checkout -b feature']);
    expect(state.head).toEqual({ type: 'branch', ref: 'feature' });
    expect(state.branches.map((b) => b.name).sort()).toEqual(['feature', 'main']);
  });

  it('無い名前を指すと、状態を一切変えずに断る', () => {
    const base = play(['git init', 'git commit -m one']);
    const result = run(base, 'git switch nope');

    expect(result.error).toContain('ありません');
    expect(result.state).toBe(base);
    expect(result.touched).toEqual([]);
  });
});

describe('git status / log', () => {
  it('コミット前の status は unborn だと言う', () => {
    const result = last(['git init', 'git status']);
    expect(result.log.join('\n')).toContain('まだコミットがありません');
  });

  it('log は HEAD から辿れるものだけ出す', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
    ]);

    const result = run(state, 'git log');
    const text = result.log.join('\n');
    expect(text).toContain('one');
    expect(text).not.toContain('枝の上');
  });

  it('log は HEAD と枝の名前を添える', () => {
    const result = last(['git init', 'git commit -m one', 'git log']);
    expect(result.log[0]).toContain('HEAD -> main');
  });
});

describe('入力の間違いへの応答', () => {
  it('未実装のコマンドは「知らない」ではなく「まだ」と言う', () => {
    const result = last(['git init', 'git commit -m one', 'git rebase main']);
    expect(result.error).toContain('まだこのサイトに入っていません');
  });

  it('打ち間違いには「もしかして」を出す', () => {
    const result = last(['git init', 'git comit -m one']);
    expect(result.log.join('\n')).toContain('もしかして git commit');
  });

  it('git を付け忘れたら、そう教える', () => {
    const result = last(['git init', 'commit -m one']);
    expect(result.error).toContain('Git のコマンドです');
  });

  it('空行は何も起こさない', () => {
    const base = play(['git init']);
    const result = run(base, '   ');
    expect(result.state).toBe(base);
    expect(result.error).toBeUndefined();
    expect(result.log).toEqual([]);
  });
});

describe('決定性', () => {
  it('同じコマンド列からは、まったく同じ状態が出る', () => {
    const lines = [
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m one',
      'git checkout -b feature',
      'git commit -m two',
      'git switch main',
      'git commit -m three',
    ];
    expect(play(lines)).toEqual(play(lines));
  });

  it('元の状態は書き換えられない', () => {
    const base = play(['git init', 'git commit -m one']);
    const snapshot = structuredClone(base);
    run(base, 'git commit -m two');
    run(base, 'git branch feature');
    expect(base).toEqual(snapshot);
  });
});
