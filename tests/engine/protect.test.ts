import { describe, expect, it } from 'vitest';
import { emptyState, resolveRevision, run } from '@/lib/git-engine';
import type { RepoState } from '@/lib/git-engine';

/**
 * 「片付いていない変更を守る」ための検査。
 *
 * ここに集めたのは、どれも**黙って作業が消えていた**ものばかり。
 * エラーも警告も出ないので、テストで固定しておかないと戻ってしまう。
 *
 * エンジンは tree（そのコミット時点の全ファイル）を正として 3 領域を組み立てる。
 * その素直な書き方をすると、tree に入っていないもの
 * ―「まだコミットしていない変更」と「Git が知らないファイル」― が通り道で落ちる。
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

/** main と feat が分かれていて、s.txt は両方で同じ中身。 */
const FORKED = [
  'git init',
  'touch s.txt',
  'git add .',
  'git commit -m 根',
  'git branch feat',
  'touch m.txt',
  'git add .',
  'git commit -m 幹',
  'git switch feat',
  'touch f.txt',
  'git add .',
  'git commit -m 枝',
  'git switch main',
];

describe('枝を移っても、書きかけは消えない', () => {
  /*
   * ほとんどのファイルは、枝をまたいでも同じ中身。
   * 「移動先の tree にあるものは持ち越さない」と書いていたので、
   * **ふつうに枝を移るだけで書きかけが消えていた**。
   */
  it('移動先でも同じ中身のファイルへの変更は、持ったまま移れる', () => {
    const dirty = play([...FORKED, 'edit s.txt 書きかけ']);
    const moved = run(dirty, 'git switch feat');

    expect(moved.error).toBeUndefined();
    expect(moved.state.work['s.txt']).toEqual(['書きかけ', '（ここに中身を書きます）']);
    expect(moved.state.workingDir.map((f) => f.path)).toEqual(['s.txt']);
  });

  it('ステージに載せたぶんも、載せたまま移れる', () => {
    const staged = play([...FORKED, 'edit s.txt 書きかけ', 'git add s.txt']);
    const moved = run(staged, 'git switch feat');

    expect(moved.state.stage['s.txt']).toEqual(['書きかけ', '（ここに中身を書きます）']);
    expect(moved.state.index.map((f) => f.path)).toEqual(['s.txt']);
  });

  it('移動先が知らないファイルは、untracked のまま付いてくる', () => {
    const moved = play([...FORKED, 'touch scratch.txt', 'git switch feat']);
    expect(moved.work['scratch.txt']).toBeDefined();
    expect(moved.workingDir.map((f) => f.path)).toContain('scratch.txt');
  });

  it('移動先で別の中身になるなら、これまでどおり移動そのものを断る', () => {
    const clashing = play([
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m 根',
      'git switch -c feat',
      'edit a.txt 枝の中身',
      'git add .',
      'git commit -m 枝',
      'git switch main',
      'edit a.txt 手元の書きかけ',
    ]);
    const refused = run(clashing, 'git switch feat');
    expect(refused.error).toContain('消えてしまいます');
    expect(refused.state).toBe(clashing);
  });
});

describe('取り込む前に、片付いているかを見る', () => {
  /*
   * merge・rebase・cherry-pick は 3 領域をまるごと入れ替える。
   * 以前はここに判定が無く、書きかけも untracked も黙って消えていた。
   */
  const cases = [
    ['git merge feat', '取り込み'],
    ['git rebase feat', '置き直し'],
    ['git cherry-pick feat', '摘み取り'],
    ['git revert HEAD', '打ち消し'],
  ] as const;

  it.each(cases)('%s は、片付いていないと断る', (line) => {
    const dirty = play([...FORKED, 'edit s.txt 書きかけ']);
    const result = run(dirty, line);

    expect(result.error).toContain('片付いていません');
    expect(result.log.join('\n')).toContain('git stash');
    // 断ったのだから、状態は 1 ミリも動いていない
    expect(result.state).toBe(dirty);
  });

  it('片付けてからなら、そのまま通る', () => {
    const clean = play([...FORKED, 'edit s.txt 書きかけ', 'git add .', 'git commit -m 片付けた']);
    expect(run(clean, 'git merge feat').error).toBeUndefined();
  });

  it('Git が知らないファイルは、片付いていない扱いにしない', () => {
    // untracked は取り込みで上書きされないので、止める理由が無い
    const withScratch = play([...FORKED, 'touch scratch.txt']);
    expect(run(withScratch, 'git merge feat').error).toBeUndefined();
  });
});

describe('git reset にパスを書いたときは、別のコマンドになる', () => {
  const staged = [
    'git init',
    'touch a.txt',
    'touch b.txt',
    'git add .',
    'git commit -m 根',
    'edit a.txt Aの変更',
    'edit b.txt Bの変更',
    'git add .',
  ];

  it('書いたパスだけがステージから降りる', () => {
    const before = play(staged);
    const result = run(before, 'git reset HEAD a.txt');

    expect(result.error).toBeUndefined();
    expect(result.state.index.map((f) => f.path)).toEqual(['b.txt']);
    expect(result.state.workingDir.map((f) => f.path)).toEqual(['a.txt']);
  });

  it('枝も HEAD も動かない', () => {
    const before = play(staged);
    const after = run(before, 'git reset HEAD~1 a.txt').state;

    expect(after.branches).toEqual(before.branches);
    expect(after.head).toEqual(before.head);
  });

  it('手元のファイルには触らない', () => {
    const after = run(play(staged), 'git reset HEAD a.txt').state;
    expect(after.work['a.txt']).toEqual(['Aの変更', '（ここに中身を書きます）']);
  });

  it('行き先を省いても、パスだけで通る', () => {
    const result = run(play(staged), 'git reset a.txt');
    expect(result.error).toBeUndefined();
    expect(result.state.index.map((f) => f.path)).toEqual(['b.txt']);
  });

  it('--hard とパスは、いっしょに使えない', () => {
    const result = run(play(staged), 'git reset --hard HEAD a.txt');
    expect(result.error).toContain('いっしょに使えません');
  });

  it('パスを書かなければ、これまでどおり枝が動く', () => {
    const before = play(staged);
    const after = run(before, 'git reset HEAD~0').state;
    expect(after.index).toEqual([]);
  });
});

describe('~ と ^ は別物', () => {
  /*
   * ひと筋道の履歴では同じ答えになるので、まとめて数えていた。
   * だがマージコミットでは食い違う ― ^2 は取り込んだ側の先端で、~2 は祖父。
   * この違いはこのサイトの主題そのものなので、まとめてはいけない。
   */
  const merged = () =>
    play([
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m A',
      'git switch -c feat',
      'touch b.txt',
      'git add .',
      'git commit -m B',
      'git switch main',
      'touch c.txt',
      'git add .',
      'git commit -m C',
      'git merge feat',
    ]);

  const messageAt = (state: RepoState, spec: string): string | undefined => {
    const id = resolveRevision(state, spec);
    return typeof id === 'string' ? state.commits[id]?.message : undefined;
  };

  it('^n は n 番目の親へ 1 つ', () => {
    const state = merged();
    expect(messageAt(state, 'HEAD^')).toBe('C');
    expect(messageAt(state, 'HEAD^1')).toBe('C');
    // 取り込んだ側の先端。以前はここが「祖父」を返していた
    expect(messageAt(state, 'HEAD^2')).toBe('B');
    expect(messageAt(state, 'HEAD^0')).toBe(messageAt(state, 'HEAD'));
    // 親は 2 つしかない
    expect(resolveRevision(state, 'HEAD^3')).toBeNull();
  });

  it('~n は第一親を n 代', () => {
    const state = merged();
    expect(messageAt(state, 'HEAD~1')).toBe('C');
    expect(messageAt(state, 'HEAD~2')).toBe('A');
    expect(messageAt(state, 'HEAD^^')).toBe('A');
  });

  it('ひと筋道なら、~ と ^ は同じ答えになる', () => {
    const state = play(['git init', 'git commit -m 一', 'git commit -m 二', 'git commit -m 三']);
    expect(resolveRevision(state, 'HEAD~1')).toBe(resolveRevision(state, 'HEAD^'));
    expect(resolveRevision(state, 'HEAD~2')).toBe(resolveRevision(state, 'HEAD^^'));
  });

  it('つなげて書ける', () => {
    const state = merged();
    // 取り込んだ側の先端の、その親
    expect(messageAt(state, 'HEAD^2~1')).toBe('A');
  });
});

describe('reset --hard は、Git が知らないファイルを消さない', () => {
  it('untracked は残り、消し方も案内する', () => {
    const before = play([
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m 一',
      'touch b.txt',
      'git add .',
      'git commit -m 二',
      'touch junk.txt',
    ]);
    const result = run(before, 'git reset --hard HEAD~1');

    expect(result.state.work['junk.txt']).toBeDefined();
    expect(result.log.join('\n')).toContain('git clean');
  });
});

describe('英字と日本語のあいだに、半角スペースが入る', () => {
  it('止まっているのが rebase なら、詰めずに書く', () => {
    const state = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'git switch -c feat',
      'edit a.txt 枝で',
      'git add .',
      'git commit -m 枝',
      'git switch main',
      'edit a.txt 幹で',
      'git add .',
      'git commit -m 幹',
      'git switch feat',
    ]);
    const paused = run(state, 'git rebase main');
    expect(paused.state.pausing?.kind).toBe('rebase');
    expect(paused.log.join('\n')).toContain('rebase は途中で止まっています');

    const refused = run(paused.state, 'git stash');
    expect(refused.error).toContain('rebase の途中です');
  });

  it('日本語どうしなら、空けない', () => {
    const paused = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'git switch -c feat',
      'edit a.txt 枝で',
      'git add .',
      'git commit -m 枝',
      'git switch main',
      'edit a.txt 幹で',
      'git add .',
      'git commit -m 幹',
      'git merge feat',
    ]);
    expect(run(paused, 'git stash').error).toContain('マージの途中です');
  });

  it('git diff の「違いはありません」も、ラベルの種類で空け方が変わる', () => {
    const state = play(['git init', 'touch a.txt x', 'git add .', 'git commit -m 根']);
    expect(run(state, 'git diff').log[0]).toContain('ステージと作業ディレクトリに違いはありません');
    expect(run(state, 'git diff HEAD').log[0]).toContain('HEAD と作業ディレクトリに違いはありません');
  });
});

describe('知らないフラグは、黙って無視しない', () => {
  const forked = [
    'git init',
    'git commit -m 根',
    'git switch -c feat',
    'git commit -m 枝',
    'git switch main',
  ];

  /*
   * 黙って落とすと、反対のことをしたうえで、それが正しいかのように説明する。
   * --no-ff を付けたのに fast-forward になり、
   * 「マージコミットは作られていません」と言ってしまっていた。
   */
  it('merge が読めないフラグは断る', () => {
    const state = play(forked);
    const result = run(state, 'git merge --no-ff feat');

    expect(result.error).toContain('扱えません');
    expect(result.log.join('\n')).not.toContain('fast-forward で');
    expect(result.state).toBe(state);
  });

  it('綴りを間違えたフラグでも断る', () => {
    expect(run(play(forked), 'git merge --xyzzy feat').error).toContain('扱えません');
  });

  it('読めるフラグは、これまでどおり通る', () => {
    expect(run(play(forked), 'git merge feat').error).toBeUndefined();
  });
});
