import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, run } from '@/lib/git-engine';
import type { CommandResult, RepoState } from '@/lib/git-engine';

function play(lines: string[], from: RepoState = emptyState()): RepoState {
  let state = from;
  for (const line of lines) {
    const result = run(state, line);
    if (result.error) throw new Error(`「${line}」で失敗: ${result.error}`);
    state = result.state;
  }
  return state;
}

function last(lines: string[]): CommandResult {
  const head = lines.slice(0, -1);
  return run(play(head), lines[lines.length - 1]);
}

/** 3 つコミットしただけの、まっすぐな履歴。 */
function straight(): RepoState {
  return play(['git init', 'git commit -m one', 'git commit -m two', 'git commit -m three']);
}

describe('git log の書式', () => {
  it('既定は commit 行とメッセージ行に分かれる', () => {
    const result = run(straight(), 'git log');
    expect(result.log[0]).toMatch(/^commit /);
    expect(result.log[1]).toBe('    three');
  });

  it('--oneline は 1 件 1 行にする', () => {
    const result = run(straight(), 'git log --oneline');
    // 3 件 + 空行 + 件数 + 説明
    expect(result.log).toHaveLength(6);
    expect(result.log[0]).not.toMatch(/^commit /);
    expect(result.log[0]).toContain('three');
    expect(result.log[2]).toContain('one');
  });

  it('マージコミットには Merge 行が付く', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git checkout -b feature',
      'touch f.txt',
      'git add .',
      'git commit -m 枝の上',
      'git switch main',
      'touch m.txt',
      'git add .',
      'git commit -m 幹の上',
      'git merge feature',
    ]);

    const text = run(state, 'git log').log.join('\n');
    expect(text).toContain('Merge: ');
  });
});

describe('git log の件数指定', () => {
  it('-n 2 は 2 件だけ出す', () => {
    const result = run(straight(), 'git log --oneline -n 2');
    expect(result.log[0]).toContain('three');
    expect(result.log[1]).toContain('two');
    expect(result.log[2]).toBe('');
    expect(result.log.join('\n')).not.toContain('one');
  });

  it('-2 と書いても同じ', () => {
    const a = run(straight(), 'git log --oneline -n 2').log;
    const b = run(straight(), 'git log --oneline -2').log;
    expect(b).toEqual(a);
  });

  it('絞ったときは、全体の件数も言う', () => {
    const result = run(straight(), 'git log -n 1');
    expect(result.log.join('\n')).toContain('全 3 件のうち');
  });
});

describe('git log --all', () => {
  /** reset --hard で 1 件を辿れなくした履歴。 */
  function withLost(): { state: RepoState; lost: string } {
    const before = play(['git init', 'git commit -m one', 'git commit -m 迷子になるほう']);
    const lost = headCommitId(before) as string;
    return { state: play(['git reset --hard HEAD~1'], before), lost };
  }

  it('既定では、辿れないコミットは出ない', () => {
    const { state } = withLost();
    const text = run(state, 'git log').log.join('\n');
    expect(text).not.toContain('迷子になるほう');
    expect(text).toContain('--all を付けると出ます');
  });

  it('--all を付けると出て、辿れないことを言う', () => {
    const { state, lost } = withLost();
    const text = run(state, 'git log --all').log.join('\n');
    expect(text).toContain('迷子になるほう');
    expect(text).toContain(lost);
    expect(text).toContain('ここからは辿れません');
    expect(text).toContain('消えてはいません');
  });

  it('辿れないものが無いときは、--all でもそう言う', () => {
    const text = run(straight(), 'git log --all').log.join('\n');
    expect(text).toContain('辿れないコミットはありません');
  });
});

describe('git log の入口', () => {
  it('リポジトリの前は断る', () => {
    expect(run(emptyState(), 'git log').error).toContain('リポジトリではありません');
  });

  it('コミットが 1 つも無ければ、そう言う', () => {
    expect(last(['git init', 'git log']).log.join('\n')).toContain('まだコミットがありません');
  });

  it('コミットが無いときは --all でも同じ', () => {
    expect(last(['git init', 'git log --all']).log.join('\n')).toContain(
      'まだコミットがありません',
    );
  });
});
