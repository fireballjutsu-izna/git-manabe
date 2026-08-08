import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, matchesIgnore, run, type RepoState } from '@/lib/git-engine';

/**
 * .gitignore と git rm --cached。
 *
 * 固めたいのは 2 点だけ。
 *   1. .gitignore は**まだ追跡していないもの**にしか効かない
 *   2. 追跡から外しても、**過去のコミットからは消えない**
 *
 * 実務の事故はどちらも 1 を知らないところから始まり、
 * 掃除の順番を間違えるのは 2 を知らないからなので、ここは強めに固定する。
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

function statusOf(state: RepoState, path: string): string | undefined {
  return state.workingDir.find((f) => f.path === path)?.status;
}

function tree(state: RepoState): Record<string, string[]> {
  const head = headCommitId(state);
  return head ? state.commits[head].tree : {};
}

describe('パターンの当たり方', () => {
  it('名前がそのまま一致する', () => {
    expect(matchesIgnore('.env', ['.env'])).toBe(true);
    expect(matchesIgnore('.env.example', ['.env'])).toBe(false);
  });

  it('ディレクトリの中でも、末尾の名前で当たる', () => {
    expect(matchesIgnore('config/.env', ['.env'])).toBe(true);
  });

  it('*.key は拡張子で当たる', () => {
    expect(matchesIgnore('deploy.key', ['*.key'])).toBe(true);
    expect(matchesIgnore('keynote.txt', ['*.key'])).toBe(false);
  });

  it('secrets/ はその下ぜんぶに当たる', () => {
    expect(matchesIgnore('secrets/a.txt', ['secrets/'])).toBe(true);
    expect(matchesIgnore('secretsa.txt', ['secrets/'])).toBe(false);
  });

  it('# の行は読まれない', () => {
    // touch .gitignore が作る既定の 1 行目はコメント。何にも当たらない
    const state = play(['git init', 'touch .gitignore', 'touch x.txt']);
    expect(state.work['.gitignore'][0].startsWith('#')).toBe(true);
    expect(statusOf(state, 'x.txt')).toBe('untracked');
  });
});

describe('追跡していないファイルには効く', () => {
  const base = () => play(['git init', 'touch .gitignore', 'append .gitignore .env']);

  it('無視されるファイルは ignored になる', () => {
    const state = play(['touch .env ひみつ'], base());
    expect(statusOf(state, '.env')).toBe('ignored');
  });

  it('git add . では入らない', () => {
    const state = play(['touch .env ひみつ', 'touch a.txt', 'git add .'], base());
    expect(state.index.map((f) => f.path)).toEqual(['.gitignore', 'a.txt']);
    expect(state.stage['.env']).toBeUndefined();
  });

  it('名指しの add は断り、-f を教える', () => {
    const state = play(['touch .env ひみつ'], base());
    const result = run(state, 'git add .env');
    expect(result.error).toContain('.gitignore で無視されています');
    expect(result.log.join('\n')).toContain('git add -f .env');
  });

  it('-f を付ければ押し切れる', () => {
    const state = play(['touch .env ひみつ', 'git add -f .env'], base());
    expect(state.stage['.env']).toBeDefined();
  });

  it('.gitignore をあとから書いても、その場で効き始める', () => {
    // 先にファイルを置いてから .gitignore を書く順
    const state = play(['git init', 'touch .env ひみつ']);
    expect(statusOf(state, '.env')).toBe('untracked');

    const after = play(['touch .gitignore', 'append .gitignore .env'], state);
    expect(statusOf(after, '.env')).toBe('ignored');
  });
});

describe('もう追跡しているファイルには効かない', () => {
  /** .env をコミットしてしまったあとの状態。 */
  const leaked = () =>
    play([
      'git init',
      'touch app.txt',
      'touch .env ひみつ',
      'git add .',
      'git commit -m 開店',
    ]);

  it('.gitignore に書いても、追跡は止まらない', () => {
    const state = play(['touch .gitignore', 'append .gitignore .env', 'edit .env 変えた'], leaked());
    // ignored ではなく modified のまま ― ここが詰まりどころ
    expect(statusOf(state, '.env')).toBe('modified');
    expect(state.tracked).toContain('.env');
  });

  it('git rm --cached で追跡から外れ、ファイルは手元に残る', () => {
    const result = run(play(['touch .gitignore', 'append .gitignore .env'], leaked()), 'git rm --cached .env');

    expect(result.error).toBeUndefined();
    expect(result.state.stage['.env']).toBeUndefined();
    expect(result.state.work['.env']).toBeDefined();
    expect(statusOf(result.state, '.env')).toBe('ignored');
  });

  it('--cached を付けないとファイルも消える', () => {
    const state = run(leaked(), 'git rm .env').state;
    expect(state.work['.env']).toBeUndefined();
  });

  it('外してコミットすると、最新の tree から消える', () => {
    const state = play(
      [
        'touch .gitignore',
        'append .gitignore .env',
        'git rm --cached .env',
        'git add .gitignore',
        'git commit -m ".env を外した"',
      ],
      leaked(),
    );

    expect(tree(state)['.env']).toBeUndefined();
    expect(tree(state)['.gitignore']).toBeDefined();
    expect(state.work['.env']).toBeDefined();
  });

  it('それでも過去のコミットには残っている', () => {
    const state = play(
      [
        'touch .gitignore',
        'append .gitignore .env',
        'git rm --cached .env',
        'git add .gitignore',
        'git commit -m ".env を外した"',
      ],
      leaked(),
    );

    const head = headCommitId(state) as string;
    const before = state.commits[head].parents[0];
    expect(state.commits[before].tree['.env']).toBeDefined();

    // diff でもそう読める
    const text = run(state, 'git diff HEAD~1 HEAD').log.join('\n');
    expect(text).toContain('deleted file');
    expect(text).toContain('.env');
  });

  it('外すときに「履歴には残る」と言う', () => {
    const result = run(leaked(), 'git rm --cached .env');
    const text = result.log.join('\n');
    expect(text).toContain('過去のコミットには');
    expect(text).toContain('作り直して');
  });
});

describe('git rm の入口', () => {
  it('追跡していないファイルは外せない', () => {
    const state = play(['git init', 'touch a.txt', 'git add .', 'git commit -m 根', 'touch b.txt']);
    expect(run(state, 'git rm --cached b.txt').error).toContain('追跡していません');
  });

  it('引数がなければ断る', () => {
    const state = play(['git init', 'touch a.txt', 'git add .', 'git commit -m 根']);
    expect(run(state, 'git rm --cached').error).toContain('何を追跡から外すのか');
  });

  it('リポジトリの前は断る', () => {
    expect(run(emptyState(), 'git rm --cached a.txt').error).toContain('リポジトリではありません');
  });
});

describe('status', () => {
  it('無視しているファイルは件数だけ言う', () => {
    const state = play([
      'git init',
      'touch .gitignore',
      'append .gitignore .env',
      'touch .env ひみつ',
    ]);
    const text = run(state, 'git status').log.join('\n');
    expect(text).toContain('無視しているファイルが 1 件');
    expect(text).not.toContain('  .env');
  });

  it('--ignored を付けると一覧になる', () => {
    const state = play([
      'git init',
      'touch .gitignore',
      'append .gitignore .env',
      'touch .env ひみつ',
    ]);
    const text = run(state, 'git status --ignored').log.join('\n');
    expect(text).toContain('無視しているファイル:');
    expect(text).toContain('.env');
  });
});

describe('append', () => {
  it('末尾に 1 行足す', () => {
    const state = play(['git init', 'touch a.txt 一行目', 'append a.txt 三行目']);
    expect(state.work['a.txt']).toEqual(['一行目', '（ここに中身を書きます）', '三行目']);
  });

  it('.gitignore の touch には説明行を入れない', () => {
    const state = play(['git init', 'touch .gitignore']);
    expect(state.work['.gitignore']).toEqual(['# Git に見せないもの']);
  });

  it('無いファイルには足せない', () => {
    expect(run(play(['git init']), 'append a.txt x').error).toContain('がありません');
  });

  it('足す行がなければ断る', () => {
    const state = play(['git init', 'touch a.txt']);
    expect(run(state, 'append a.txt').error).toContain('足す行を書いてください');
  });
});
