import { describe, expect, it } from 'vitest';
import { emptyState, run, type RepoState } from '@/lib/git-engine';
import { DOCS } from '@/lib/docs';
import { LEVELS, checkLevel, playCommands, setupState, shapeSignature } from '@/lib/levels';

/**
 * レベルの定義そのものを検査する。
 *
 * 内容がコードではなくデータなので、壊れても型検査には引っかからない。
 * 「解けないレベル」「setup の時点で合格しているレベル」は、
 * ここで捕まえないと本番で気づけない。
 */

/** 各レベルの模範解答。ここを通して合格することを確かめる。 */
const SOLUTIONS: Record<string, string[]> = {
  areas: ['touch hello.txt', 'git add .', 'git commit -m はじめ'],
  branch: ['git switch -c feature', 'git commit -m 枝の上'],
  detached: ['git checkout HEAD~1'],
  'fast-forward': ['git switch main', 'git merge feature'],
  'three-way': ['git merge feature'],
  'reset-modes': ['git reset --soft HEAD~1'],
  revert: ['git revert HEAD'],
  stash: ['git stash'],
  'cherry-pick': ['git cherry-pick feature~1'],
  rebase: ['git rebase main'],
  reflog: ['git switch -c 救出 HEAD@{1}'],
  remote: ['git pull origin main'],
  ignore: [
    'touch .gitignore',
    'append .gitignore .env',
    'git rm --cached .env',
    'git add .gitignore',
    'git commit -m ".env を追跡から外した"',
  ],
  interactive: ['git rebase -i main', 'todo squash 2', 'todo drop 3', 'todo run'],
  conflict: ['git merge feature', 'git checkout --ours app.ts', 'git add app.ts', 'git commit'],
};

describe('レベルの定義', () => {
  it('id が重複していない', () => {
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('どのレベルにも合格条件がある', () => {
    for (const level of LEVELS) {
      expect(level.goal !== undefined || level.check !== undefined, level.id).toBe(true);
    }
  });

  it('どのレベルにもヒントがある', () => {
    for (const level of LEVELS) {
      expect(level.hints.length, level.id).toBeGreaterThan(0);
    }
  });

  it('模範解答がすべてのレベルぶん揃っている', () => {
    expect(Object.keys(SOLUTIONS).sort()).toEqual(LEVELS.map((l) => l.id).sort());
  });
});

describe.each(LEVELS.map((l) => [l.id, l] as const))('レベル %s', (id, level) => {
  it('setup が最後まで通る', () => {
    expect(() => setupState(level)).not.toThrow();
  });

  it('goal も最後まで通る', () => {
    if (level.goal) expect(() => playCommands(level.goal!)).not.toThrow();
  });

  it('開始した時点では、まだ合格していない', () => {
    // ここが合格していると、何もせずに通ってしまう
    expect(checkLevel(level, setupState(level)).passed, id).toBe(false);
  });

  it('模範解答で合格する', () => {
    let state: RepoState = setupState(level);
    for (const line of SOLUTIONS[id]) {
      const result = run(state, line);
      expect(result.error, `${id}: ${line}`).toBeUndefined();
      state = result.state;
    }
    const outcome = checkLevel(level, state);
    expect(outcome.missing, id).toEqual([]);
    expect(outcome.passed, id).toBe(true);
  });
});

describe('形の比べ方', () => {
  const play = (lines: string[]): RepoState => playCommands(lines, emptyState());

  it('コミット id が違っても、形が同じなら一致する', () => {
    // メッセージも順番も違うが、構造は同じ
    const a = play(['git init', 'git commit -m あ', 'git commit -m い']);
    const b = play(['git init', 'git commit -m x', 'git commit -m y']);
    expect(shapeSignature(a)).toBe(shapeSignature(b));
  });

  it('コミットの数が違えば、一致しない', () => {
    const a = play(['git init', 'git commit -m 一']);
    const b = play(['git init', 'git commit -m 一', 'git commit -m 二']);
    expect(shapeSignature(a)).not.toBe(shapeSignature(b));
  });

  it('枝の名前が違えば、一致しない', () => {
    const a = play(['git init', 'git commit -m 一', 'git branch feature']);
    const b = play(['git init', 'git commit -m 一', 'git branch topic']);
    expect(shapeSignature(a)).not.toBe(shapeSignature(b));
  });

  it('HEAD の位置が違えば、一致しない', () => {
    const base = ['git init', 'git commit -m 一', 'git branch feature'];
    const a = play(base);
    const b = play([...base, 'git switch feature']);
    expect(shapeSignature(a)).not.toBe(shapeSignature(b));
  });

  it('マージの有無で一致しない', () => {
    const diverged = [
      'git init',
      'git commit -m 根',
      'git switch -c feature',
      'git commit -m 枝',
      'git switch main',
      'git commit -m 幹',
    ];
    expect(shapeSignature(play(diverged))).not.toBe(
      shapeSignature(play([...diverged, 'git merge feature'])),
    );
  });

  it('リモート追跡ブランチの位置も見る', () => {
    const pushed = [
      'git init',
      'git commit -m 一',
      'git remote add origin x',
      'git push origin main',
    ];
    const a = play(pushed);
    const b = play([...pushed, 'teammate 1', 'git fetch origin']);
    expect(shapeSignature(a)).not.toBe(shapeSignature(b));
  });
});

describe('記事とレベルの対応', () => {
  it('記事とレベルの id が 1 対 1 で揃っている', () => {
    // DocNav がレベルへ送り、レベルが記事へ返す。
    // 片方だけ増えると、リンクが黙って消える
    expect(DOCS.map((d) => d.id)).toEqual(LEVELS.map((l) => l.id));
  });

  it('記事の題がレベルの題と食い違っていない', () => {
    // 完全一致までは求めない（記事のほうが長い題を付けることがある）が、
    // 別物になっていたら、たどり着いた人が混乱する
    for (const doc of DOCS) {
      const level = LEVELS.find((l) => l.id === doc.id)!;
      const core = (s: string) => s.split(/[―—]/)[0].trim();
      expect(core(doc.title), doc.id).toBe(core(level.title));
    }
  });

  it('どの記事にも 1 行の要約がある', () => {
    for (const doc of DOCS) expect(doc.summary.length, doc.id).toBeGreaterThan(10);
  });
});

describe('ボタンに出す名前', () => {
  it('課題文に名前が書いてあるレベルは、その名前を suggest に持っている', () => {
    // ボタンが file-1.txt を出すのに課題が hello.txt を求めていると、
    // 押しても課題が終わらない
    const FILE = /[A-Za-z0-9_-]+\.(?:txt|ts|md|js)/g;
    for (const level of LEVELS) {
      // setup が用意したファイルは、ユーザーが作るものではないので対象外
      const prepared = new Set(level.setup.join(' ').match(FILE) ?? []);
      const asked = (level.task.match(FILE) ?? []).filter((f) => !prepared.has(f));
      if (asked.length === 0) continue;
      expect(level.suggest?.file, `${level.id} の課題は ${asked[0]} を求めている`).toBe(asked[0]);
    }
  });

  it('suggest の名前が、setup ですでに埋まっていない', () => {
    // 埋まっていると、ボタンは自動生成の名前に落ちるので指定した意味が無い
    for (const level of LEVELS) {
      const state = setupState(level);
      if (level.suggest?.file) {
        expect(state.tracked.includes(level.suggest.file), level.id).toBe(false);
      }
      if (level.suggest?.branch) {
        expect(
          state.branches.some((b) => b.name === level.suggest!.branch),
          level.id,
        ).toBe(false);
      }
    }
  });
});
