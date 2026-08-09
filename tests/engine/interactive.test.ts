import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, run, type RepoState } from '@/lib/git-engine';

/**
 * 対話的 rebase（git rebase -i）。
 *
 * 素の rebase との違いは 1 点だけ ―**当てる前に計画を書き換えられる**。
 * だから固めたいのも 2 つで足りる。
 *   1. -i を打っただけでは履歴が何も変わらない
 *   2. squash / drop / reword / 並べ替えが、実行したときにそのとおりになる
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

/** HEAD から第一親をたどったメッセージを、新しい順に。 */
function chain(state: RepoState): string[] {
  const out: string[] = [];
  let cursor = headCommitId(state);
  while (cursor) {
    const commit = state.commits[cursor];
    if (!commit) break;
    out.push(commit.message);
    cursor = commit.parents[0] ?? null;
  }
  return out;
}

/** feature に 3 件、main に 1 件。分かれているので置き直せる。 */
const THREE = [
  'git init',
  'touch a.txt',
  'git add .',
  'git commit -m 根',
  'git switch -c feature',
  'touch b.txt',
  'git add .',
  'git commit -m ラッピングを直した',
  'touch c.txt',
  'git add .',
  'git commit -m typo',
  'touch d.txt',
  'git add .',
  'git commit -m デバッグ用のログ',
  'git switch main',
  'touch m.txt',
  'git add .',
  'git commit -m 幹の変更',
  'git switch feature',
];

describe('-i は計画を立てるだけ', () => {
  it('打っても履歴は何も変わらない', () => {
    const before = play(THREE);
    const after = run(before, 'git rebase -i main');

    expect(after.error).toBeUndefined();
    expect(after.state.commits).toEqual(before.commits);
    expect(after.state.branches).toEqual(before.branches);
    expect(after.state.head).toEqual(before.head);
  });

  it('todo が古い順に並ぶ', () => {
    const state = play([...THREE, 'git rebase -i main']);
    expect(state.todo?.items.map((i) => i.message)).toEqual([
      'ラッピングを直した',
      'typo',
      'デバッグ用のログ',
    ]);
    expect(state.todo?.items.every((i) => i.action === 'pick')).toBe(true);
  });

  it('計画中は、関係のないコマンドを断る', () => {
    const state = play([...THREE, 'git rebase -i main']);
    for (const line of ['git commit -m x', 'git merge main', 'git switch main']) {
      expect(run(state, line).error, line).toContain('計画を立てて');
    }
  });

  it('計画中でも log と status は読める', () => {
    const state = play([...THREE, 'git rebase -i main']);
    expect(run(state, 'git log').error).toBeUndefined();
    expect(run(state, 'git status').error).toBeUndefined();
  });

  it('--abort でやめると、何も起きていない', () => {
    const before = play(THREE);
    const after = run(play([...THREE, 'git rebase -i main']), 'git rebase --abort');

    expect(after.state.todo).toBeNull();
    expect(after.state.commits).toEqual(before.commits);
    expect(after.log.join('\n')).toContain('何も変わっていません');
  });

  it('計画の外で todo を打つと断る', () => {
    expect(run(play(THREE), 'todo run').error).toContain('計画を立てているところではありません');
  });

  /*
   * 実務でいちばん多い使い方は「push する前に、自分のコミットだけを整える」。
   * このとき枝は分かれていないので、素の rebase なら「すでに上にいます」で終わる。
   * -i はそこでも開かないと使いものにならない。
   */
  it('分かれていなくても開ける', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git switch -c feature',
      'git commit -m 一つ目',
      'git commit -m 二つ目',
    ]);

    // 素の rebase は、置き直すものが無いと言う
    expect(run(state, 'git rebase main').log.join('\n')).toContain('すでに main の上にいます');

    // -i は開く
    const opened = run(state, 'git rebase -i main');
    expect(opened.error).toBeUndefined();
    expect(opened.state.todo?.items.map((i) => i.message)).toEqual(['一つ目', '二つ目']);
  });

  it('HEAD~2 のような指定でも開ける', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git commit -m 一つ目',
      'git commit -m 二つ目',
    ]);
    const opened = run(state, 'git rebase -i HEAD~2');
    expect(opened.error).toBeUndefined();
    expect(opened.state.todo?.items.map((i) => i.message)).toEqual(['一つ目', '二つ目']);
  });

  it('書き換えるものが無ければ断る', () => {
    const state = play(['git init', 'git commit -m 根']);
    expect(run(state, 'git rebase -i HEAD').error).toContain('いまいるコミットそのもの');
  });
});

describe('計画を組み立てる', () => {
  const planning = () => play([...THREE, 'git rebase -i main']);

  it('squash は 1 行目には付けられない', () => {
    expect(run(planning(), 'todo squash 1').error).toContain('1 行目は squash にできません');
  });

  it('reword はメッセージが要る', () => {
    expect(run(planning(), 'todo reword 1').error).toContain('メッセージを書いてください');
  });

  it('reword で書き換えると、元も覚えている', () => {
    const state = run(planning(), 'todo reword 1 花束の包み方を直した').state;
    expect(state.todo?.items[0]).toMatchObject({
      action: 'reword',
      message: '花束の包み方を直した',
      original: 'ラッピングを直した',
    });
  });

  it('pick に戻すと、メッセージも元へ戻る', () => {
    const state = play(['todo reword 1 別の文', 'todo pick 1'], planning());
    expect(state.todo?.items[0].message).toBe('ラッピングを直した');
  });

  it('up / down で並べ替えられる', () => {
    const state = run(planning(), 'todo down 1').state;
    expect(state.todo?.items.map((i) => i.message)).toEqual([
      'typo',
      'ラッピングを直した',
      'デバッグ用のログ',
    ]);
  });

  it('端は動かせない', () => {
    expect(run(planning(), 'todo up 1').error).toContain('これ以上は動かせません');
    expect(run(planning(), 'todo down 3').error).toContain('これ以上は動かせません');
  });

  it('並べ替えて 1 行目が squash になるなら断る', () => {
    const state = run(planning(), 'todo squash 2').state;
    expect(run(state, 'todo up 2').error).toContain('1 行目が squash になってしまいます');
  });

  it('無い行番号は断る', () => {
    expect(run(planning(), 'todo drop 9').error).toContain('という行はありません');
  });

  it('todo list は番号付きで出す', () => {
    const text = run(planning(), 'todo list').log.join('\n');
    expect(text).toContain('1  pick');
    expect(text).toContain('ラッピングを直した');
  });
});

describe('実行する', () => {
  const planning = () => play([...THREE, 'git rebase -i main']);

  it('何も変えずに実行すると、素の rebase と同じ', () => {
    const state = run(planning(), 'todo run').state;
    expect(chain(state)).toEqual([
      'デバッグ用のログ',
      'typo',
      'ラッピングを直した',
      '幹の変更',
      '根',
    ]);
    expect(state.todo).toBeNull();
  });

  it('squash は 1 つ上にまとまる', () => {
    const state = play(['todo squash 2', 'todo run'], planning());
    expect(chain(state)).toEqual([
      'デバッグ用のログ',
      'ラッピングを直した + typo',
      '幹の変更',
      '根',
    ]);
  });

  it('squash でも、まとめた側の中身は両方入る', () => {
    const state = play(['todo squash 2', 'todo run'], planning());
    const squashed = state.commits[state.commits[headCommitId(state) as string].parents[0]];
    expect(Object.keys(squashed.tree).sort()).toEqual(['a.txt', 'b.txt', 'c.txt', 'm.txt']);
  });

  it('drop は落ちる', () => {
    const state = play(['todo drop 3', 'todo run'], planning());
    expect(chain(state)).toEqual(['typo', 'ラッピングを直した', '幹の変更', '根']);
    // 落としたコミットも消えてはいない
    expect(Object.values(state.commits).some((c) => c.message === 'デバッグ用のログ')).toBe(true);
  });

  it('reword はメッセージだけ変わる', () => {
    const state = play(['todo reword 1 花束の包み方を直した', 'todo run'], planning());
    expect(chain(state)[2]).toBe('花束の包み方を直した');
  });

  it('並べ替えた順に積まれる', () => {
    const state = play(['todo down 1', 'todo run'], planning());
    expect(chain(state)).toEqual([
      'デバッグ用のログ',
      'ラッピングを直した',
      'typo',
      '幹の変更',
      '根',
    ]);
  });

  it('squash と drop を組み合わせられる', () => {
    const state = play(['todo squash 2', 'todo drop 3', 'todo run'], planning());
    expect(chain(state)).toEqual(['ラッピングを直した + typo', '幹の変更', '根']);
  });

  it('全部 drop は断る', () => {
    const state = play(['todo drop 1', 'todo drop 2', 'todo drop 3'], planning());
    expect(run(state, 'todo run').error).toContain('置き直すものが無くなります');
  });

  it('id はすべて変わる', () => {
    const before = planning();
    const originals = before.todo?.items.map((i) => i.id) as string[];
    const state = run(before, 'todo run').state;

    const after = new Set<string>();
    let cursor = headCommitId(state);
    for (let i = 0; i < 3 && cursor; i += 1) {
      after.add(cursor);
      cursor = state.commits[cursor].parents[0] ?? null;
    }
    expect(originals.some((id) => after.has(id))).toBe(false);
  });
});

describe('実行の途中でぶつかる', () => {
  /** feature の 2 件が、どちらも main と同じ行を触る。 */
  const CLASH = [
    'git init',
    'touch a.txt 元',
    'git add .',
    'git commit -m 根',
    'git switch -c feature',
    'edit a.txt 枝 1',
    'git add .',
    'git commit -m 枝の 1 つ目',
    'edit a.txt 枝 2',
    'git add .',
    'git commit -m 枝の 2 つ目',
    'git switch main',
    'edit a.txt 幹',
    'git add .',
    'git commit -m 幹の変更',
    'git switch feature',
  ];

  it('止まり方は素の rebase と同じ', () => {
    const result = run(play([...CLASH, 'git rebase -i main']), 'todo run');
    expect(result.error).toBeUndefined();
    expect(result.state.pausing?.kind).toBe('rebase');
    expect(result.log.join('\n')).toContain('git rebase --continue');
  });

  it('--continue で計画の続きへ戻る', () => {
    const done = play([
      ...CLASH,
      'git rebase -i main',
      'todo run',
      'git checkout --theirs a.txt',
      'git add a.txt',
      'git rebase --continue',
    ]);
    expect(done.pausing).toBeNull();
    expect(chain(done)).toEqual(['枝の 2 つ目', '枝の 1 つ目', '幹の変更', '根']);
  });

  it('squash の途中で止まっても、まとめたまま続く', () => {
    const done = play([
      ...CLASH,
      'git rebase -i main',
      'todo squash 2',
      'todo run',
      'git checkout --theirs a.txt',
      'git add a.txt',
      'git rebase --continue',
    ]);
    expect(done.pausing).toBeNull();
    // 2 件が 1 つにまとまっている
    expect(chain(done)).toEqual(['枝の 1 つ目 + 枝の 2 つ目', '幹の変更', '根']);
  });

  it('--abort で置き直す前に戻る', () => {
    const before = play(CLASH);
    const after = run(play([...CLASH, 'git rebase -i main', 'todo run']), 'git rebase --abort').state;

    expect(after.pausing).toBeNull();
    expect(after.todo).toBeNull();
    expect(after.branches.find((b) => b.name === 'feature')?.target).toBe(
      before.branches.find((b) => b.name === 'feature')?.target,
    );
  });
});

describe('決定性', () => {
  it('同じ手順からは、同じ状態が出る', () => {
    const lines = [...THREE, 'git rebase -i main', 'todo squash 2', 'todo drop 3', 'todo run'];
    expect(play(lines)).toEqual(play(lines));
  });
});
