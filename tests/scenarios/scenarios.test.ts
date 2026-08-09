import { describe, expect, it } from 'vitest';
import { run, type RepoState } from '@/lib/git-engine';
import { DOCS } from '@/lib/docs';
import { playCommands } from '@/lib/levels';
import { SCENARIOS, starsFor, type Scenario } from '@/lib/scenarios';

/**
 * シナリオの定義そのものを検査する。
 *
 * 中身がコードではなくデータなので、壊れても型検査には引っかからない。
 * とくに怖いのが「開始時点ですでに満たされているステップ」で、
 * これがあると何もせずに話が進んでしまい、遊ぶ側は理由が分からない。
 */

/** 各シナリオの模範解答。ステップごとに、そこで打つコマンドを並べる。 */
const SOLUTIONS: Record<string, string[][]> = {
  hotfix: [
    ['git stash'],
    ['git switch main', 'git switch -c hotfix'],
    ['edit bouquet.txt', 'git add bouquet.txt', 'git commit -m 傷んだ花を差し替えた'],
    ['git switch main', 'git merge hotfix'],
    ['git switch new-design', 'git stash pop'],
  ],
  review: [
    ['git reset --soft HEAD~2', 'git commit -m スタンドとリボンを用意した'],
    ['git revert HEAD'],
    ['git switch main', 'git merge arrange'],
  ],
  behind: [['git fetch origin'], ['git merge origin/main'], ['git push origin main']],
  'wrong-branch': [['git branch winter'], ['git reset --hard HEAD~1'], ['git switch winter']],
  clash: [
    ['git merge spring'],
    ['git checkout --theirs vase.txt'],
    ['git add vase.txt'],
    ['git commit'],
  ],
  secret: [
    ['git rm --cached .env'],
    ['touch .gitignore', 'append .gitignore .env'],
    ['git add .gitignore', 'git commit -m ".env を追跡から外した"'],
    ['git push origin main'],
  ],
  resend: [
    ['git rebase -i main'],
    ['todo squash 2', 'todo squash 3'],
    ['todo run'],
    ['git push --force-with-lease origin poster'],
    ['git switch main', 'git merge poster'],
  ],
  showcase: [
    // cherry-pick の id は状態から引くので、ここでは印だけ置く
    ['<cherry-pick:傷んだ葉を直した>'],
    ['git push origin main'],
    ['git merge workshop'],
    ['git push origin main'],
  ],
};

/** 模範解答の中の印を、そのときの状態から本物のコマンドに直す。 */
function resolve(line: string, state: RepoState): string {
  const pick = line.match(/^<cherry-pick:(.+)>$/);
  if (!pick) return line;
  const target = Object.values(state.commits).find((c) => c.message === pick[1]);
  if (!target) throw new Error(`${pick[1]} というコミットがありません`);
  return `git cherry-pick ${target.id}`;
}

/** 1 ステップぶん打つ。打った手数を返す。 */
function playStep(state: RepoState, lines: string[], label: string): [RepoState, number] {
  let next = state;
  for (const raw of lines) {
    const line = resolve(raw, next);
    const result = run(next, line);
    expect(result.error, `${label}: ${line}`).toBeUndefined();
    next = result.state;
  }
  return [next, lines.length];
}

const setupOf = (scenario: Scenario): RepoState => playCommands(scenario.setup);

describe('シナリオの定義', () => {
  it('id が重複していない', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('模範解答がすべてのシナリオぶん揃っている', () => {
    expect(Object.keys(SOLUTIONS).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  it('uses に書いた概念が、記事として実在する', () => {
    const known = new Set(DOCS.map((d) => d.id));
    for (const scenario of SCENARIOS) {
      for (const id of scenario.uses) {
        expect(known.has(id), `${scenario.id} の uses: ${id}`).toBe(true);
      }
    }
  });

  it('どのステップにもヒントと、素の言い方での指示がある', () => {
    for (const scenario of SCENARIOS) {
      for (const [i, step] of scenario.steps.entries()) {
        expect(step.hints.length, `${scenario.id} #${i + 1}`).toBeGreaterThan(0);
        expect(step.task.length, `${scenario.id} #${i + 1}`).toBeGreaterThan(5);
        expect(step.message.length, `${scenario.id} #${i + 1}`).toBeGreaterThan(5);
      }
    }
  });
});

describe.each(SCENARIOS.map((s) => [s.id, s] as const))('シナリオ %s', (id, scenario) => {
  it('setup が最後まで通る', () => {
    expect(() => setupOf(scenario)).not.toThrow();
  });

  it('模範解答のステップ数が、定義と揃っている', () => {
    expect(SOLUTIONS[id]).toHaveLength(scenario.steps.length);
  });

  it('模範解答で最後まで進み、各ステップは打つ前には満たされていない', () => {
    let state = setupOf(scenario);

    for (const [i, step] of scenario.steps.entries()) {
      const label = `${id} #${i + 1}`;

      // ここが要点。打つ前に満たされていると、何もせず話が進んでしまう
      expect(step.check(state), `${label}: 開始時点ですでに満たされています`).toBe(false);

      const [after] = playStep(state, SOLUTIONS[id][i], label);
      state = after;

      expect(step.check(state), `${label}: 模範解答で満たせません`).toBe(true);
    }
  });

  it('par が模範解答の手数と一致する', () => {
    // ずれていると、模範解答どおり解いても星が 3 つにならない
    for (const [i, step] of scenario.steps.entries()) {
      expect(step.par, `${id} #${i + 1}`).toBe(SOLUTIONS[id][i].length);
    }
  });
});

describe('星の付け方', () => {
  it('par ちょうどなら 3 つ', () => {
    expect(starsFor(5, 5)).toBe(3);
  });

  it('par より少なくても 3 つ', () => {
    expect(starsFor(3, 5)).toBe(3);
  });

  it('2 手までの回り道なら 2 つ', () => {
    expect(starsFor(6, 5)).toBe(2);
    expect(starsFor(7, 5)).toBe(2);
  });

  it('それ以上かかったら 1 つ', () => {
    expect(starsFor(8, 5)).toBe(1);
    expect(starsFor(99, 5)).toBe(1);
  });
});
