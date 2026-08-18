import { describe, expect, it } from 'vitest';
import { bisectRange, emptyState, headCommitId, run } from '@/lib/git-engine';
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

/** 最後の 1 行だけ結果を見たいとき。 */
function last(lines: string[], from: RepoState = emptyState()): CommandResult {
  const head = lines.slice(0, -1);
  return run(play(head, from), lines[lines.length - 1]);
}

/**
 * 8 個のコミットを積む。shop.txt は 4 番目から「閉まっています」になる。
 *
 * 「どこで壊れたか」が定義から目で読めるようにしておく ―
 * 探索の結果と突き合わせるときに、期待値を計算し直さなくて済む。
 */
function shop(): RepoState {
  const lines = [
    'git init',
    'touch shop.txt 開いています',
    'touch notes.txt メモ',
    'git add .',
    'git commit -m 一つ目',
  ];
  for (let i = 2; i <= 8; i += 1) {
    // ふだんは関係ないファイルだけ触る。4 つ目でだけ shop.txt を壊す。
    // 壊したあとは直さない ― 直してしまうと二分探索が成り立たない
    lines.push(`edit notes.txt メモ（${i}）`);
    if (i === 4) lines.push('edit shop.txt 閉まっています');
    lines.push('git add .', `git commit -m ${i}つ目`);
  }
  return play(lines);
}

/** 上から n 番目（1 が最初のコミット）の id。 */
function nth(state: RepoState, n: number): string {
  return Object.values(state.commits)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)[n - 1].id;
}

/** いま止まっているコミットが壊れているか。中身を見て決める。 */
function broken(state: RepoState): boolean {
  return state.work['shop.txt']?.[0] === '閉まっています';
}

describe('git bisect', () => {
  it('始めるには bad と good の両方が要る', () => {
    const state = shop();
    const started = run(state, 'git bisect start');
    expect(started.error).toBeUndefined();
    expect(started.log.join('\n')).toContain('git bisect bad');

    const withBad = run(started.state, 'git bisect bad');
    expect(withBad.log.join('\n')).toContain('git bisect good');
    // まだ範囲が決まっていないので、HEAD は動かない
    expect(headCommitId(withBad.state)).toBe(headCommitId(state));
  });

  it('範囲が決まると、その真ん中へ移る', () => {
    const state = shop();
    const first = nth(state, 1);
    const result = play(['git bisect start', 'git bisect bad', `git bisect good ${first}`], state);

    expect(result.head.type).toBe('detached');
    expect(result.bisect?.testing).toBe(headCommitId(result));
    // 8 個のうち、最初の 1 つは good、いちばん新しい 1 つは bad。残り 6 個から選ぶ
    expect(result.bisect?.testing).not.toBe(first);
    expect(result.bisect?.testing).not.toBe(result.bisect?.bad);
  });

  it('中身を見て答えていくと、壊したコミットに行き着く', () => {
    let state = play(['git bisect start', 'git bisect bad', `git bisect good ${nth(shop(), 1)}`], shop());

    // 実際にやることと同じ手順 ― 移った先の中身を見て、good か bad かを答える
    let rounds = 0;
    while (state.bisect && !state.bisect.culprit && state.bisect.testing) {
      state = run(state, broken(state) ? 'git bisect bad' : 'git bisect good').state;
      rounds += 1;
      expect(rounds).toBeLessThan(10);
    }

    const culprit = state.bisect?.culprit;
    expect(culprit).toBeDefined();
    expect(state.commits[culprit as string].message).toBe('4つ目');
    // 8 個を 1 個に絞るのに、3 回で足りる
    expect(rounds).toBeLessThanOrEqual(3);
  });

  it('1 つずつ戻すより、はっきり少ない回数で終わる', () => {
    // 32 個積んで、20 個目で壊す（そこから先は壊れたまま）
    const lines = [
      'git init',
      'touch app.txt ok',
      'touch notes.txt メモ',
      'git add .',
      'git commit -m 1',
    ];
    for (let i = 2; i <= 32; i += 1) {
      lines.push(`edit notes.txt メモ（${i}）`);
      if (i === 20) lines.push('edit app.txt ng');
      lines.push('git add .', `git commit -m ${i}`);
    }
    let state = play(lines);
    const first = nth(state, 1);
    state = play(['git bisect start', 'git bisect bad', `git bisect good ${first}`], state);

    let rounds = 0;
    while (state.bisect && !state.bisect.culprit && state.bisect.testing) {
      const ng = state.work['app.txt']?.[0] === 'ng';
      state = run(state, ng ? 'git bisect bad' : 'git bisect good').state;
      rounds += 1;
      expect(rounds).toBeLessThan(40);
    }

    expect(state.commits[state.bisect?.culprit as string].message).toBe('20');
    // 31 個の候補は 5 回で 1 つになる。1 つずつなら最悪 31 回
    expect(rounds).toBeLessThanOrEqual(5);
  });

  it('残り何個・あと何回を、毎回言う', () => {
    const state = shop();
    const result = last(
      ['git bisect start', 'git bisect bad', `git bisect good ${nth(state, 1)}`],
      state,
    );
    expect(result.log.join('\n')).toMatch(/残り \d+ 個。あと約 \d+ 回/);
  });

  it('skip すると、そのコミットは選ばれなくなる', () => {
    const state = shop();
    let next = play(['git bisect start', 'git bisect bad', `git bisect good ${nth(state, 1)}`], state);
    const skipped = next.bisect?.testing as string;
    next = run(next, 'git bisect skip').state;

    expect(next.bisect?.verdicts[skipped]).toBe('skip');
    expect(next.bisect?.testing).not.toBe(skipped);
  });

  it('飛ばしたぶんだけが残ったら、絞れないと言う', () => {
    const state = play([
      'git init',
      'touch a.txt ok',
      'git add .',
      'git commit -m 一つ目',
      'edit a.txt ok2',
      'git add .',
      'git commit -m 二つ目',
      'edit a.txt ng',
      'git add .',
      'git commit -m 三つ目',
    ]);
    const first = nth(state, 1);
    const started = play(['git bisect start', 'git bisect bad', `git bisect good ${first}`], state);
    // 候補は 2 つ目だけ。それを飛ばすと、もう調べるものが無い
    const result = run(started, 'git bisect skip');

    expect(result.log.join('\n')).toContain('絞れません');
    expect(result.state.bisect?.culprit).toBeNull();
  });

  it('reset で、始める前の枝へ戻る', () => {
    const state = shop();
    const before = headCommitId(state);
    let next = play(['git bisect start', 'git bisect bad', `git bisect good ${nth(state, 1)}`], state);
    expect(next.head.type).toBe('detached');

    next = run(next, 'git bisect reset').state;
    expect(next.head).toEqual({ type: 'branch', ref: 'main' });
    expect(headCommitId(next)).toBe(before);
    expect(next.bisect).toBeNull();
    // 中身も戻っている（8 つ目の時点。shop.txt は 4 つ目から壊れたまま）
    expect(next.work['notes.txt']?.[0]).toBe('メモ（8）');
    expect(next.work['shop.txt']?.[0]).toBe('閉まっています');
  });

  it('good と bad が逆だと、そう言って断る', () => {
    const state = shop();
    const first = nth(state, 1);
    const result = last(['git bisect start', `git bisect bad ${first}`, 'git bisect good'], state);
    expect(result.error).toBeDefined();
    expect(result.log.join('\n')).toContain('良いのは古い側');
  });

  it('start に bad と good をまとめて書ける', () => {
    const state = shop();
    const first = nth(state, 1);
    const result = play([`git bisect start HEAD ${first}`], state);
    expect(result.bisect?.testing).toBeDefined();
    expect(result.head.type).toBe('detached');
  });

  it('探す範囲は bad の祖先から good の祖先を除いたもの', () => {
    const state = shop();
    const first = nth(state, 1);
    const started = play(['git bisect start', 'git bisect bad', `git bisect good ${first}`], state);
    const range = bisectRange(started, started.bisect!);

    // 8 個のうち、いちばん古い 1 つ（good）だけが外れる
    expect(range).toHaveLength(7);
    expect(range).not.toContain(first);
  });

  it('見つかったあとに good や bad を打っても、もう受け付けない', () => {
    let state = play(['git bisect start', 'git bisect bad', `git bisect good ${nth(shop(), 1)}`], shop());
    while (state.bisect && !state.bisect.culprit && state.bisect.testing) {
      state = run(state, broken(state) ? 'git bisect bad' : 'git bisect good').state;
    }
    const result = run(state, 'git bisect good');
    expect(result.error).toBeDefined();
    expect(result.log.join('\n')).toContain('もう見つかっています');
  });

  it('始めていないうちに good を打つと、始め方を案内する', () => {
    const result = run(shop(), 'git bisect good');
    expect(result.error).toBeDefined();
    expect(result.log.join('\n')).toContain('git bisect start');
  });

  it('二重に start はできない', () => {
    const state = shop();
    const result = last(['git bisect start', 'git bisect start'], state);
    expect(result.error).toBeDefined();
    expect(state.bisect).toBeNull();
  });

  it('知らないサブコマンドは、使えるものを挙げて断る', () => {
    const result = run(shop(), 'git bisect run');
    expect(result.error).toBeDefined();
    expect(result.log.join('\n')).toContain('start / good / bad / skip / log / reset');
  });

  it('log に、打った順がそのまま残る', () => {
    const state = shop();
    const result = last(
      ['git bisect start', 'git bisect bad', `git bisect good ${nth(state, 1)}`, 'git bisect log'],
      state,
    );
    expect(result.log[0]).toBe('git bisect start');
    expect(result.log[1]).toMatch(/^git bisect bad /);
    expect(result.log[2]).toMatch(/^git bisect good /);
  });

  it('コミットが 1 つも無ければ始められない', () => {
    const result = last(['git init', 'git bisect start']);
    expect(result.error).toBeDefined();
    expect(result.log.join('\n')).toContain('探すもの');
  });

  it('片付いていない変更があるうちは、始めさせない', () => {
    // まだコミットしていない書きかけを持ったまま始めようとする
    const dirty = play(['edit shop.txt まだ書きかけ'], shop());
    const result = run(dirty, 'git bisect start');

    expect(result.error).toBeDefined();
    expect(result.log.join('\n')).toContain('shop.txt');
    expect(result.log.join('\n')).toContain('git stash');
    expect(result.state.bisect).toBeNull();
  });
});

describe('cat', () => {
  it('作業ディレクトリの中身を、そのまま出す', () => {
    const state = play(['git init', 'touch memo.txt 一行目']);
    const result = run(state, 'cat memo.txt');
    expect(result.error).toBeUndefined();
    expect(result.log[0]).toContain('memo.txt');
    expect(result.log[1]).toContain('一行目');
  });

  it('無いファイルは、あるものを挙げて断る', () => {
    const state = play(['git init', 'touch memo.txt']);
    const result = run(state, 'cat other.txt');
    expect(result.error).toBeDefined();
    expect(result.log.join('\n')).toContain('memo.txt');
  });

  it('ぶつかって止まっている間も打てる（目印を読むために要る）', () => {
    const state = play([
      'git init',
      'touch bouquet.txt 白',
      'git add .',
      'git commit -m はじめ',
      'git switch -c spring',
      'edit bouquet.txt 春の花',
      'git add .',
      'git commit -m 春',
      'git switch main',
      'edit bouquet.txt 店長が生けた',
      'git add .',
      'git commit -m 店長',
    ]);
    const merged = run(state, 'git merge spring');
    expect(merged.state.pausing).not.toBeNull();

    const result = run(merged.state, 'cat bouquet.txt');
    expect(result.error).toBeUndefined();
    expect(result.log.join('\n')).toContain('<<<<<<<');
    expect(result.log.join('\n')).toContain('>>>>>>>');
  });
});
