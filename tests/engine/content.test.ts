import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, run, type RepoState } from '@/lib/git-engine';

/**
 * ファイルの中身。
 *
 * ここが入るまで、このサイトは「どのパスが変わったか」しか持っていなかった。
 * tree（そのコミット時点の全ファイル）が正しく積まれ、
 * reset / checkout / stash で正しく戻ることを、いちばん強く固定しておく ―
 * ここがずれると、diff もコンフリクトも全部おかしくなる。
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

function tree(state: RepoState): Record<string, string[]> {
  const head = headCommitId(state);
  return head ? state.commits[head].tree : {};
}

describe('touch と edit', () => {
  it('touch は 2 行のファイルを作る', () => {
    const state = play(['git init', 'touch a.txt']);
    expect(state.work['a.txt']).toEqual(['a.txt', '（ここに中身を書きます）']);
  });

  it('touch に中身を書ける', () => {
    const state = play(['git init', 'touch a.txt 春の花']);
    expect(state.work['a.txt'][0]).toBe('春の花');
  });

  it('edit は 1 行目だけを差し替える', () => {
    const state = play(['git init', 'touch a.txt', 'edit a.txt 夏の花']);
    expect(state.work['a.txt']).toEqual(['夏の花', '（ここに中身を書きます）']);
  });

  it('中身を省いた edit は、打つたびに違う行になる', () => {
    const state = play(['git init', 'touch a.txt', 'edit a.txt']);
    const first = state.work['a.txt'][0];
    const after = play(['edit a.txt'], state);
    expect(after.work['a.txt'][0]).not.toBe(first);
  });
});

describe('tree が積まれる', () => {
  it('コミットの tree は、そのときのステージそのもの', () => {
    const state = play([
      'git init',
      'touch a.txt 一つ目',
      'touch b.txt 二つ目',
      'git add .',
      'git commit -m 根',
    ]);
    expect(Object.keys(tree(state)).sort()).toEqual(['a.txt', 'b.txt']);
    expect(tree(state)['a.txt'][0]).toBe('一つ目');
  });

  it('tree は前のコミットのぶんも引き継ぐ', () => {
    const state = play([
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m 一つ目',
      'touch b.txt',
      'git add .',
      'git commit -m 二つ目',
    ]);
    expect(Object.keys(tree(state)).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('paths は tree の差から導かれる ― 変えていないファイルは入らない', () => {
    const state = play([
      'git init',
      'touch a.txt',
      'touch b.txt',
      'git add .',
      'git commit -m 根',
      'edit a.txt 変えた',
      'git add .',
      'git commit -m a だけ',
    ]);
    const head = headCommitId(state) as string;
    expect(state.commits[head].paths).toEqual(['a.txt']);
  });

  it('add していないファイルは tree に入らない', () => {
    const state = play([
      'git init',
      'touch a.txt',
      'git add .',
      'touch b.txt',
      'git commit -m a だけ',
    ]);
    expect(Object.keys(tree(state))).toEqual(['a.txt']);
    expect(state.work['b.txt']).toBeDefined();
  });
});

describe('3 領域と中身', () => {
  it('add は中身をステージへ写す', () => {
    const state = play(['git init', 'touch a.txt 中身', 'git add .']);
    expect(state.stage['a.txt']).toEqual(state.work['a.txt']);
  });

  it('add したあとに変えても、ステージは変わらない', () => {
    const state = play(['git init', 'touch a.txt 最初', 'git add .', 'edit a.txt あと']);
    expect(state.stage['a.txt'][0]).toBe('最初');
    expect(state.work['a.txt'][0]).toBe('あと');
  });
});

describe('reset のモードごとの中身', () => {
  const base = () =>
    play([
      'git init',
      'touch a.txt 一つ目',
      'git add .',
      'git commit -m 根',
      'edit a.txt 二つ目',
      'git add .',
      'git commit -m 次',
    ]);

  it('--soft はどちらも触らない', () => {
    const state = run(base(), 'git reset --soft HEAD~1').state;
    expect(state.stage['a.txt'][0]).toBe('二つ目');
    expect(state.work['a.txt'][0]).toBe('二つ目');
  });

  it('--mixed はステージだけ戻す', () => {
    const state = run(base(), 'git reset --mixed HEAD~1').state;
    expect(state.stage['a.txt'][0]).toBe('一つ目');
    expect(state.work['a.txt'][0]).toBe('二つ目');
  });

  it('--hard は両方戻す', () => {
    const state = run(base(), 'git reset --hard HEAD~1').state;
    expect(state.stage['a.txt'][0]).toBe('一つ目');
    expect(state.work['a.txt'][0]).toBe('一つ目');
  });
});

describe('checkout と中身', () => {
  const two = [
    'git init',
    'touch a.txt 幹',
    'git add .',
    'git commit -m 根',
    'git switch -c feature',
    'edit a.txt 枝',
    'git add .',
    'git commit -m 枝で変更',
  ];

  it('枝を移ると、手元のファイルもその枝のものになる', () => {
    const state = play([...two, 'git switch main']);
    expect(state.work['a.txt'][0]).toBe('幹');
    expect(state.stage['a.txt'][0]).toBe('幹');
  });

  it('戻ればまた枝の中身になる', () => {
    const state = play([...two, 'git switch main', 'git switch feature']);
    expect(state.work['a.txt'][0]).toBe('枝');
  });

  it('消えてしまう変更があるときは、移動そのものを断る', () => {
    const result = run(play([...two, 'edit a.txt まだ途中']), 'git switch main');
    expect(result.error).toContain('移動すると消えてしまいます');
    expect(result.state.work['a.txt'][0]).toBe('まだ途中');
  });

  it('移動先が知らないファイルは、そのまま持っていける', () => {
    const state = play([...two, 'touch new.txt', 'git switch main']);
    expect(state.work['new.txt']).toBeDefined();
    expect(state.workingDir).toEqual([{ path: 'new.txt', status: 'untracked' }]);
  });

  it('stash してからなら移れる', () => {
    const state = play([...two, 'edit a.txt まだ途中', 'git stash', 'git switch main']);
    expect(state.work['a.txt'][0]).toBe('幹');
  });
});

describe('stash と中身', () => {
  it('退避すると、コミットそのままの中身に戻る', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'edit a.txt 作業中',
      'git stash',
    ]);
    expect(state.work['a.txt'][0]).toBe('元');
  });

  it('pop すると、退避した中身が返ってくる', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'edit a.txt 作業中',
      'git stash',
      'git stash pop',
    ]);
    expect(state.work['a.txt'][0]).toBe('作業中');
  });
});

describe('git diff', () => {
  it('add していないぶんが出る', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'edit a.txt 直した',
    ]);
    const text = run(state, 'git diff').log.join('\n');
    expect(text).toContain('-元');
    expect(text).toContain('+直した');
    // 変えていない行は、印なしで文脈として出る
    expect(text).toContain(' （ここに中身を書きます）');
  });

  it('add したものは、引数なしの diff には出ない', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'edit a.txt 直した',
      'git add .',
    ]);
    expect(run(state, 'git diff').log.join('\n')).toContain('違いはありません');
    expect(run(state, 'git diff --staged').log.join('\n')).toContain('+直した');
  });

  it('新しいファイルは new file として出る', () => {
    const state = play(['git init', 'touch a.txt', 'git add .', 'git commit -m 根', 'touch b.txt']);
    const text = run(state, 'git diff').log.join('\n');
    expect(text).toContain('new file');
    expect(text).toContain('+b.txt');
  });

  it('コミットを指定すると、いま手元にあるものと比べる', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'edit a.txt 直した',
      'git add .',
      'git commit -m 次',
    ]);
    const text = run(state, 'git diff HEAD~1').log.join('\n');
    expect(text).toContain('-元');
    expect(text).toContain('+直した');
  });

  it('コミットを 2 つ指定すると、手元の状態は関係ない', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'edit a.txt 直した',
      'git add .',
      'git commit -m 次',
      'edit a.txt まだ途中',
    ]);
    const text = run(state, 'git diff HEAD~1 HEAD').log.join('\n');
    expect(text).toContain('+直した');
    expect(text).not.toContain('まだ途中');
  });

  it('--staged とコミットの指定は、いっしょに使えない', () => {
    const state = play(['git init', 'touch a.txt', 'git add .', 'git commit -m 根']);
    expect(run(state, 'git diff --staged HEAD').error).toContain('いっしょに使えません');
  });

  it('無いコミットは断る', () => {
    const state = play(['git init', 'touch a.txt', 'git add .', 'git commit -m 根']);
    expect(run(state, 'git diff zzzzzzz').error).toContain('という枝もコミットもありません');
  });

  it('リポジトリの前は断る', () => {
    expect(run(emptyState(), 'git diff').error).toContain('リポジトリではありません');
  });
});

describe('merge は中身を持ち込む', () => {
  it('向こうだけが変えたファイルは、そのまま入る', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'touch b.txt 元',
      'git add .',
      'git commit -m 根',
      'git switch -c feature',
      'edit a.txt 枝が直した',
      'git add .',
      'git commit -m 枝',
      'git switch main',
      'edit b.txt 幹が直した',
      'git add .',
      'git commit -m 幹',
      'git merge feature',
    ]);

    expect(state.work['a.txt'][0]).toBe('枝が直した');
    expect(state.work['b.txt'][0]).toBe('幹が直した');
    expect(tree(state)['a.txt'][0]).toBe('枝が直した');
  });

  it('fast-forward でも中身が入れ替わる', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'git switch -c feature',
      'edit a.txt 枝が直した',
      'git add .',
      'git commit -m 枝',
      'git switch main',
      'git merge feature',
    ]);
    expect(state.work['a.txt'][0]).toBe('枝が直した');
  });
});

describe('revert は中身を戻す', () => {
  it('打ち消したあとの中身が、1 つ前と同じになる', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'edit a.txt 直した',
      'git add .',
      'git commit -m 直した',
      'git revert HEAD',
    ]);
    expect(state.work['a.txt'][0]).toBe('元');
    expect(tree(state)['a.txt'][0]).toBe('元');
    // 履歴は消えていない
    expect(Object.keys(state.commits)).toHaveLength(3);
  });
});
