import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, run, type RepoState } from '@/lib/git-engine';
// mergeContent は入口（index）から出していないので、直に読む
import { mergeContent } from '@/lib/git-engine/content';

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

/**
 * 3-way マージそのもの。
 *
 * ここに並ぶ 11 件は、本物の git（2.43.0）で同じ 3 つの版を作って
 * merge させ、出てきた v.txt をそのまま期待値にしている ―
 * 行数が変わると丸ごとぶつけていた頃は、上 5 件が全部ぶつかっていた。
 *
 * 重なりの判定が「触れ合ったらぶつける」なのも本物に合わせたもの。
 * 変更と変更の間に、変わっていない行が 1 行でも残っていれば通る。
 */
describe('mergeContent（本物の git と突き合わせた）', () => {
  const merge = (base: string[] | undefined, ours: string[], theirs: string[]) =>
    mergeContent(base, ours, theirs, 'HEAD', 'feature');

  it('両側が末尾に別々の行を足すと、本物と同じくぶつかる', () => {
    // 足す場所が同じ（どちらも末尾）なので、本物の git も CONFLICT を出す
    const r = merge(['1行目'], ['1行目', '幹が足した行'], ['1行目', '枝が足した行']);
    expect(r.conflicted).toBe(true);
    expect(r.kinds).toEqual(['both-added']);
    expect(r.content).toEqual([
      '1行目',
      '<<<<<<< HEAD',
      '幹が足した行',
      '=======',
      '枝が足した行',
      '>>>>>>> feature',
    ]);
  });

  it('両側が先頭に別々の行を足しても、同じくぶつかる', () => {
    const r = merge(['1行目'], ['幹が足した行', '1行目'], ['枝が足した行', '1行目']);
    expect(r.kinds).toEqual(['both-added']);
    expect(r.content?.[0]).toBe('<<<<<<< HEAD');
    expect(r.content?.at(-1)).toBe('1行目');
  });

  it('片側が上、片側が下なら、行数が変わっても黙って両方入る', () => {
    const base = ['a', 'b', 'c', 'd', 'e', 'f'];
    const r = merge(base, ['a幹', 'b', 'c', 'd', 'e', 'f'], ['a', 'b', 'c', 'd', 'e', 'f枝']);
    expect(r.conflicted).toBe(false);
    expect(r.content).toEqual(['a幹', 'b', 'c', 'd', 'e', 'f枝']);
  });

  it('片側が行を足し、片側が離れた行を直しても、両方入る', () => {
    const base = ['a', 'b', 'c', 'd', 'e'];
    const r = merge(base, ['a', 'X', 'b', 'c', 'd', 'e'], ['a', 'b', 'c幹', 'd', 'e']);
    expect(r.conflicted).toBe(false);
    expect(r.content).toEqual(['a', 'X', 'b', 'c幹', 'd', 'e']);
  });

  it('変更が 1 行離れていれば通る', () => {
    const base = ['a', 'b', 'c', 'd', 'e'];
    const r = merge(base, ['a', 'b幹', 'c', 'd', 'e'], ['a', 'b', 'c', 'd枝', 'e']);
    expect(r.conflicted).toBe(false);
    expect(r.content).toEqual(['a', 'b幹', 'c', 'd枝', 'e']);
  });

  it('変更が隣り合っていると、別々の行でもぶつかる', () => {
    // 本物の git も、間に変わっていない行が無いとここで止まる
    const r = merge(['a', 'b', 'c', 'd'], ['a', 'b幹', 'c', 'd'], ['a', 'b', 'c枝', 'd']);
    expect(r.kinds).toEqual(['nearby']);
    expect(r.content).toEqual([
      'a',
      '<<<<<<< HEAD',
      'b幹',
      'c',
      '=======',
      'b',
      'c枝',
      '>>>>>>> feature',
      'd',
    ]);
  });

  it('足した行と、そのすぐ下の行への変更もぶつかる', () => {
    const base = ['a', 'b', 'c', 'd', 'e'];
    const r = merge(base, ['a', 'X', 'b', 'c', 'd', 'e'], ['a', 'b幹', 'c', 'd', 'e']);
    expect(r.kinds).toEqual(['nearby']);
    expect(r.content).toEqual([
      'a',
      '<<<<<<< HEAD',
      'X',
      'b',
      '=======',
      'b幹',
      '>>>>>>> feature',
      'c',
      'd',
      'e',
    ]);
  });

  it('両側が同じ行を違う中身にすると、その行だけを囲む', () => {
    const r = merge(['a', 'b', 'c'], ['a', 'b幹', 'c'], ['a', 'b枝', 'c']);
    expect(r.kinds).toEqual(['same-line']);
    expect(r.content).toEqual([
      'a',
      '<<<<<<< HEAD',
      'b幹',
      '=======',
      'b枝',
      '>>>>>>> feature',
      'c',
    ]);
  });

  it('片側が消した行を片側が直すと、こちら側が空のまま囲まれる', () => {
    // 本物の git も、消えた側には 1 行も書かない
    const r = merge(['a', 'b', 'c'], ['a', 'c'], ['a', 'b枝', 'c']);
    expect(r.kinds).toEqual(['line-deleted']);
    expect(r.content).toEqual(['a', '<<<<<<< HEAD', '=======', 'b枝', '>>>>>>> feature', 'c']);
  });

  it('両側が同じ行を同じ中身に直したなら、ぶつからない', () => {
    const r = merge(['a', 'b', 'c'], ['a', 'bどちらも', 'c'], ['a', 'bどちらも', 'c']);
    expect(r.conflicted).toBe(false);
    expect(r.content).toEqual(['a', 'bどちらも', 'c']);
  });

  it('両側が同じ行を足したなら、1 行だけ入る', () => {
    const r = merge(['a'], ['a', '同じ行'], ['a', '同じ行']);
    expect(r.conflicted).toBe(false);
    expect(r.content).toEqual(['a', '同じ行']);
  });

  it('離れた 2 か所は、それぞれ別々に囲まれる', () => {
    const base = ['a', 'b', 'c', 'd', 'e'];
    const r = merge(base, ['a幹', 'b', 'c', 'd', 'e幹'], ['a枝', 'b', 'c', 'd', 'e枝']);
    expect(r.kinds).toEqual(['same-line', 'same-line']);
    expect(r.content?.filter((l) => l === '=======')).toHaveLength(2);
  });
});
