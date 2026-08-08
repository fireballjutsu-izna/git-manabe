import type { RepoState } from '@/lib/git-engine';

/**
 * リポジトリの「形」を、id に依らない文字列にする。
 *
 * レベルの合格判定に使う。同じ形にたどり着けたなら、
 * **どういう手順で来たかは問わない**ようにしたい。
 * コミット id もメッセージも比べないのはそのため
 * （メッセージまで一致を求めると、ただの写経になってしまう）。
 *
 * 比べるのは 3 つだけ:
 *   - 枝の名前と、その枝から見た履歴の形
 *   - HEAD がどこにいるか
 *   - リモート追跡ブランチの位置
 */

/** 1 つのコミットから見た履歴の形。`(())` のような入れ子で表す。 */
function shapeOf(state: RepoState, id: string, memo: Map<string, string>): string {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;

  const commit = state.commits[id];
  if (!commit) return '?';

  // 壊れたデータで無限に潜らないための目印
  memo.set(id, '*');
  const shape = `(${commit.parents.map((p) => shapeOf(state, p, memo)).join(',')})`;
  memo.set(id, shape);
  return shape;
}

export function shapeSignature(state: RepoState): string {
  const memo = new Map<string, string>();

  const branches = [...state.branches]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => `${b.name}=${shapeOf(state, b.target, memo)}`);

  const remotes = [...state.remoteBranches]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => `${r.name}=${shapeOf(state, r.target, memo)}`);

  const head =
    state.head.type === 'branch'
      ? `HEAD->${state.head.ref}`
      : `HEAD=${shapeOf(state, state.head.oid, memo)}`;

  return [head, ...branches, ...remotes].join('|');
}

/** 2 つの状態が、同じ形になっているか。 */
export function sameShape(a: RepoState, b: RepoState): boolean {
  return shapeSignature(a) === shapeSignature(b);
}
