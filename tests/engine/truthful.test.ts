import { describe, expect, it } from 'vitest';
import { ancestorsOf, emptyState, run } from '@/lib/git-engine';
import type { RepoState } from '@/lib/git-engine';

/**
 * 「記事が言っていることと、エンジンがすることを合わせる」ための検査。
 *
 * ここに集めたのは、記事が本物の Git の仕様として書いていたのに
 * 実際には違っていたもの ―
 * シミュレータの都合を、本物の話として教えてしまっていた種類の誤り。
 *
 * どれも本物の git 2.43 で実際に走らせて確かめてある。
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

/** 両側が同じ行を変えた形。merge するとぶつかる。 */
const CLASHING = [
  'git init',
  'touch v.txt 元',
  'git add .',
  'git commit -m 根',
  'git switch -c feature',
  'edit v.txt 枝の版',
  'git add .',
  'git commit -m 枝',
  'git switch main',
  'edit v.txt 幹の版',
  'git add .',
  'git commit -m 幹',
];

describe('git merge --continue', () => {
  /*
   * 本物には 2.12（2017 年）からある。
   * 「merge には --continue が無い、続きが無いから」と理由まで付けて教えていたが、
   * それはこのサイトの実装の話であって、本物の仕様ではなかった。
   */
  it('決着のあと、commit と同じようにマージを終えられる', () => {
    const resolved = play([...CLASHING, 'git merge feature', 'git checkout --ours v.txt', 'git add v.txt']);
    const result = run(resolved, 'git merge --continue');

    expect(result.error).toBeUndefined();
    expect(result.state.pausing).toBeNull();
    const head = result.state.branches.find((b) => b.name === 'main')?.target as string;
    expect(result.state.commits[head].parents).toHaveLength(2);
  });

  it('git commit で終えたときと、同じ結果になる', () => {
    const resolved = play([...CLASHING, 'git merge feature', 'git checkout --ours v.txt', 'git add v.txt']);
    const viaCommit = run(resolved, 'git commit').state;
    const viaContinue = run(resolved, 'git merge --continue').state;
    expect(viaContinue.commits).toEqual(viaCommit.commits);
  });

  it('止まっていないときは、そう言う', () => {
    expect(run(play(CLASHING), 'git merge --continue').error).toContain('止まっていません');
  });

  it('止まっているのが rebase なら、rebase の続け方を案内する', () => {
    const paused = play([...CLASHING, 'git switch feature']);
    const stopped = run(paused, 'git rebase main').state;
    expect(stopped.pausing?.kind).toBe('rebase');

    const result = run(stopped, 'git merge --continue');
    expect(result.error).toContain('rebase');
    expect(result.log.join('\n')).toContain('git rebase --continue');
  });
});

describe('マージコミットの既定のメッセージ', () => {
  /*
   * 本物は既定の枝（main / master）へ取り込むときだけ into を付けない。
   * 記事が git log の出力として載せているので、文言までそろえる。
   */
  it('main へ取り込むと into が付かない', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git switch -c feature',
      'git commit -m 枝',
      'git switch main',
      'git commit -m 幹',
      'git merge feature',
    ]);
    const head = state.branches.find((b) => b.name === 'main')?.target as string;
    expect(state.commits[head].message).toBe("Merge branch 'feature'");
  });

  it('main 以外へ取り込むと into が付く', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git switch -c develop',
      'git commit -m 開発',
      'git switch -c feature',
      'git commit -m 枝',
      'git switch develop',
      'git commit -m 開発2',
      'git merge feature',
    ]);
    const head = state.branches.find((b) => b.name === 'develop')?.target as string;
    expect(state.commits[head].message).toBe("Merge branch 'feature' into develop");
  });
});

describe('タグと枝は、別の入れ物', () => {
  /*
   * タグは refs/tags、枝は refs/heads。名前空間が別なので同じ名前を持てる。
   * 本物も両方作れて、名前だけで指すと warning: refname is ambiguous を出す。
   * 「同じ名前は使えません」と教えていたのは誤りで、しかも読者が反証できた。
   */
  const base = ['git init', 'git commit -m 根'];

  it('タグが先でも、同じ名前の枝を作れる', () => {
    const result = run(play([...base, 'git tag v1.0']), 'git branch v1.0');
    expect(result.error).toBeUndefined();
    expect(result.state.branches.map((b) => b.name)).toContain('v1.0');
    expect(result.log.join('\n')).toContain('決められなくなります');
  });

  it('枝が先でも、同じ名前のタグを付けられる', () => {
    const result = run(play([...base, 'git branch v1.0']), 'git tag v1.0');
    expect(result.error).toBeUndefined();
    expect(result.state.tags.map((t) => t.name)).toContain('v1.0');
    expect(result.log.join('\n')).toContain('決められなくなります');
  });

  it('ぶつかっていなければ、余計なことは言わない', () => {
    expect(run(play(base), 'git tag v1.0').log.join('\n')).not.toContain('決められなくなります');
  });

  it('名前だけで指すと、枝のほうが選ばれる', () => {
    // 本物も同じ（警告を出したうえで refs/heads を採る）
    const state = play([...base, 'git commit -m 二', 'git tag v1.0 HEAD~1', 'git branch v1.0']);
    const moved = run(state, 'git switch v1.0').state;
    expect(moved.head).toEqual({ type: 'branch', ref: 'v1.0' });
  });
});

describe('git branch -d は、取り込んでいない枝を断る', () => {
  /*
   * -d と -D の差＝安全弁そのもの。ここを通してしまうと、
   * 名前を外した瞬間にどこからも辿れなくなることに気づけない。
   */
  const forked = [
    'git init',
    'git commit -m 根',
    'git switch -c work',
    'git commit -m まだ取り込んでいない',
    'git switch main',
  ];

  it('取り込んでいない枝は -d では消えない', () => {
    const result = run(play(forked), 'git branch -d work');
    expect(result.error).toContain('まだどこにも取り込まれていません');
    expect(result.log.join('\n')).toContain('git branch -D work');
    expect(result.state.branches.map((b) => b.name)).toContain('work');
  });

  it('-D なら消える。辿れなくなることも言う', () => {
    const result = run(play(forked), 'git branch -D work');
    expect(result.error).toBeUndefined();
    expect(result.state.branches.map((b) => b.name)).not.toContain('work');
    expect(result.log.join('\n')).toContain('辿れなくなりました');
  });

  it('取り込み済みなら -d で消える', () => {
    const merged = play([...forked, 'git merge work']);
    const result = run(merged, 'git branch -d work');
    expect(result.error).toBeUndefined();
    expect(result.log.join('\n')).not.toContain('辿れなくなりました');
  });
});

describe('git commit は、読めないフラグを断る', () => {
  /*
   * --amend が黙って通ると、直前のコミットを書き換えたつもりが
   * 新しいコミットが 1 つ増える。log を見るまで気づけない。
   */
  it('--amend は断り、代わりの手順を案内する', () => {
    const state = play(['git init', 'git commit -m 一つ目', 'git commit -m tpyo']);
    const result = run(state, 'git commit --amend -m 直した');

    expect(result.error).toContain('扱えません');
    expect(result.log.join('\n')).toContain('git reset --soft HEAD~1');
    expect(Object.keys(result.state.commits)).toHaveLength(2);
  });

  it('案内どおりに打てば、実際にやり直せる', () => {
    const state = play([
      'git init',
      'git commit -m 一つ目',
      'git commit -m tpyo',
      'git reset --soft HEAD~1',
      'git commit -m 直した',
    ]);
    // main から辿れるのは「一つ目 → 直した」。tpyo は残っているが、もう辿れない
    const tip = state.branches.find((b) => b.name === 'main')?.target as string;
    const reachable = [...ancestorsOf(state, tip)].map((id) => state.commits[id].message);
    expect(reachable).toContain('直した');
    expect(reachable).not.toContain('tpyo');
  });

  it('-m は、これまでどおり通る', () => {
    expect(run(play(['git init']), 'git commit -m 根').error).toBeUndefined();
  });
});

describe('git checkout -- <path> ― 手元の変更を捨てる', () => {
  /*
   * 3 領域を前へ運ぶ話（add / commit）はあるのに、
   * 逆向きに戻す手段が 1 つも無かった。
   * reset <path> はステージから降ろすだけで、手元のファイルには触らない。
   */
  const committed = ['git init', 'touch a.txt', 'git add .', 'git commit -m 根'];

  it('書きかけを捨てて、ステージの中身に戻る', () => {
    const dirty = play([...committed, 'edit a.txt 書きかけ']);
    const result = run(dirty, 'git checkout -- a.txt');

    expect(result.error).toBeUndefined();
    expect(result.state.work['a.txt']).not.toContain('書きかけ');
    expect(result.state.workingDir).toEqual([]);
    expect(result.log.join('\n')).toContain('取り消せません');
  });

  it('-- が無くても、枝でもコミットでもないなら、ファイルとして読む', () => {
    const dirty = play([...committed, 'edit a.txt 書きかけ']);
    expect(run(dirty, 'git checkout a.txt').error).toBeUndefined();
  });

  it('枝と同じ名前のファイルがあっても、-- を書けば読み分けられる', () => {
    const state = play([...committed, 'git branch a.txt', 'edit a.txt 書きかけ']);
    // -- なしなら枝として読む（本物と同じ順）
    expect(run(state, 'git checkout a.txt').state.head).toEqual({ type: 'branch', ref: 'a.txt' });
    // -- を書けばファイル
    const discarded = run(state, 'git checkout -- a.txt');
    expect(discarded.state.head).toEqual({ type: 'branch', ref: 'main' });
    expect(discarded.state.work['a.txt']).not.toContain('書きかけ');
  });

  it('ステージに載せたぶんは、戻す先になる', () => {
    // add してから、さらに書き換えて、捨てる
    const state = play([...committed, 'edit a.txt 載せた版', 'git add a.txt', 'edit a.txt その後の書きかけ']);
    const result = run(state, 'git checkout -- a.txt');

    expect(result.state.work['a.txt']?.[0]).toBe('載せた版');
    expect(result.log.join('\n')).toContain('git reset <path>');
  });

  it('Git が知らないファイルは、戻す先が無いと言う', () => {
    const state = play([...committed, 'touch scratch.txt']);
    const result = run(state, 'git checkout -- scratch.txt');
    expect(result.error).toContain('まだ知らないファイル');
  });

  it('変わっていなければ、そう言うだけ', () => {
    expect(run(play(committed), 'git checkout -- a.txt').log.join('\n')).toContain('同じ中身');
  });
});

describe('git revert -m ― マージの打ち消しは扱っていない', () => {
  /*
   * -m のあとを全部メッセージとして飲むパーサなので、
   * 断らないと「何を打ち消すのか書いてください」という的外れな答えになる。
   * 打った本人は打ち消す相手を書いている。
   */
  it('-m を付けたら、扱っていないと言う', () => {
    const state = play(['git init', 'git commit -m 根', 'git commit -m 二']);
    const result = run(state, 'git revert -m 1 HEAD');

    expect(result.error).toContain('マージコミットの revert');
    expect(result.error).not.toContain('何を打ち消すのか');
  });

  it('-m が無ければ、これまでどおり打ち消せる', () => {
    const state = play(['git init', 'git commit -m 根', 'git commit -m 二']);
    expect(run(state, 'git revert HEAD').error).toBeUndefined();
  });
});
