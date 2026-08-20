import { describe, expect, it } from 'vitest';
import { emptyState, layoutGraph, run, type RepoState } from '@/lib/git-engine';

function play(lines: string[]): RepoState {
  let state = emptyState();
  for (const line of lines) {
    const result = run(state, line);
    if (result.error) throw new Error(`「${line}」で失敗: ${result.error}`);
    state = result.state;
  }
  return state;
}

/** id → 座標 の形にして、テストから読みやすくする。 */
function at(state: RepoState): Record<string, { row: number; lane: number }> {
  const out: Record<string, { row: number; lane: number }> = {};
  for (const n of layoutGraph(state).nodes) out[n.id] = { row: n.row, lane: n.lane };
  return out;
}

function idOf(state: RepoState, message: string): string {
  const commit = Object.values(state.commits).find((c) => c.message === message);
  if (!commit) throw new Error(`${message} というコミットがありません`);
  return commit.id;
}

/** 上から下へ、行の順にメッセージを並べる。 */
function messagesTopDown(state: RepoState): string[] {
  return layoutGraph(state)
    .nodes.slice()
    .sort((a, b) => a.row - b.row)
    .map((n) => state.commits[n.id].message);
}

describe('コミットが無いとき', () => {
  it('空のレイアウトを返す', () => {
    expect(layoutGraph(emptyState())).toEqual({ nodes: [], edges: [], rows: 0, lanes: 0 });
  });
});

describe('並ぶ向き', () => {
  it('新しいコミットが上に来る', () => {
    // git log と同じ並び。打ったばかりのものが必ず最上段に出るので、
    // 履歴が伸びてもスクロールせずに追える
    const state = play(['git init', 'git commit -m 一', 'git commit -m 二', 'git commit -m 三']);
    expect(messagesTopDown(state)).toEqual(['三', '二', '一']);
  });

  it('1 行に 1 コミットだけが乗る', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
    ]);
    const layout = layoutGraph(state);

    // 行が情報の単位なので、2 つ乗ると id もメッセージも重なって読めない
    const rows = layout.nodes.map((n) => n.row);
    expect(new Set(rows).size).toBe(rows.length);
    expect(layout.rows).toBe(Object.keys(state.commits).length);
  });

  it('親は必ず子より下の行にいる', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
      'git merge feature',
    ]);
    const rows = at(state);
    for (const commit of Object.values(state.commits)) {
      for (const parent of commit.parents) {
        expect(rows[parent].row, `${commit.message} の親`).toBeGreaterThan(rows[commit.id].row);
      }
    }
  });

  it('辺は親から子へ張られる', () => {
    const state = play(['git init', 'git commit -m one', 'git commit -m two']);
    expect(layoutGraph(state).edges).toEqual([
      { from: idOf(state, 'one'), to: idOf(state, 'two') },
    ]);
  });
});

describe('レーン', () => {
  it('1 本の鎖なら、全部が同じレーンに乗る', () => {
    const state = play(['git init', 'git commit -m one', 'git commit -m two', 'git commit -m three']);
    const layout = layoutGraph(state);
    expect(layout.lanes).toBe(1);
    expect(layout.nodes.every((n) => n.lane === 0)).toBe(true);
  });

  it('main はレーン 0 に残り、分かれた枝が別のレーンに乗る', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
    ]);
    const rows = at(state);

    expect(rows[idOf(state, 'one')].lane).toBe(0);
    expect(rows[idOf(state, '幹の上')].lane).toBe(0);
    expect(rows[idOf(state, '枝の上')].lane).toBeGreaterThan(0);
    expect(layoutGraph(state).lanes).toBe(2);
  });

  it('feature を先に伸ばしても、レーン 0 は main のもの', () => {
    // 枝の作成順ではなく名前で決まることを見る
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
    ]);
    const rows = at(state);
    expect(rows[idOf(state, '根')].lane).toBe(0);
    expect(rows[idOf(state, '幹の上')].lane).toBe(0);
    expect(rows[idOf(state, '枝の上')].lane).toBe(1);
  });

  it('枝を切って 1 回コミットしただけでも、レーンは分ける', () => {
    // 詰めれば 1 レーンに収まるが、そうすると main の流れと feature の流れが
    // 同じレーン・同じ色になり、1 本の連続した流れに見えてしまう。
    // 親子関係は辺が示すので、レーンを分けても嘘にはならない。
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
    ]);
    expect(layoutGraph(state).lanes).toBe(2);
    expect(at(state)[idOf(state, '枝の上')].lane).toBe(1);
    expect(layoutGraph(state).edges).toEqual([
      { from: idOf(state, '根'), to: idOf(state, '枝の上') },
    ]);
  });

  it('無関係な流れが、同じレーンに載ることはない', () => {
    // 「空いたレーンを使い回す」実装だと、ここで無関係な区間が並んでしまう
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b a',
      'git commit -m aの上',
      'git switch main',
      'git checkout -b b',
      'git commit -m bの上',
      'git switch main',
      'git commit -m mainの上',
    ]);
    const rows = at(state);
    const lanes = [
      rows[idOf(state, 'mainの上')].lane,
      rows[idOf(state, 'aの上')].lane,
      rows[idOf(state, 'bの上')].lane,
    ];
    expect(new Set(lanes).size).toBe(3);
    expect(layoutGraph(state).lanes).toBe(3);
  });
});

describe('安定性', () => {
  it('同じ状態からは、いつも同じ座標が出る', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git checkout -b feature',
      'git commit -m two',
      'git switch main',
      'git commit -m three',
    ]);
    expect(layoutGraph(state)).toEqual(layoutGraph(state));
  });

  it('コミットを 1 つ足しても、既にあるコミットのレーンは動かない', () => {
    // 行は 1 つずつ下へずれる（新しいものが上に入るので当然）。
    // だがレーンまで入れ替わると、グラフ全体が横に飛び跳ねて読めなくなる
    const before = play([
      'git init',
      'git commit -m one',
      'git checkout -b feature',
      'git commit -m two',
    ]);
    const beforeAt = at(before);

    const after = run(before, 'git commit -m three').state;
    const afterAt = at(after);

    for (const id of Object.keys(beforeAt)) {
      expect(afterAt[id].lane, id).toBe(beforeAt[id].lane);
      expect(afterAt[id].row, id).toBe(beforeAt[id].row + 1);
    }
  });
});

describe('マージコミット', () => {
  it('2 本の辺が 1 つのコミットに入ってくる', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
      'git merge feature',
    ]);

    const layout = layoutGraph(state);
    const merge = Object.values(state.commits).find((c) => c.parents.length === 2)!;

    const incoming = layout.edges.filter((e) => e.to === merge.id);
    expect(incoming).toHaveLength(2);
    expect(incoming.map((e) => e.from).sort()).toEqual(
      [idOf(state, '幹の上'), idOf(state, '枝の上')].sort(),
    );
  });

  it('マージコミットは幹のレーンに乗り、枝は別のレーンに残る', () => {
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
      'git merge feature',
    ]);
    const rows = at(state);
    const merge = Object.values(state.commits).find((c) => c.parents.length === 2)!;

    expect(rows[merge.id].lane).toBe(0);
    expect(rows[merge.id].row).toBe(0); // いちばん新しいので最上段
    expect(rows[idOf(state, '幹の上')].lane).toBe(0);
    expect(rows[idOf(state, '枝の上')].lane).toBe(1);
    expect(rows[idOf(state, '根')].lane).toBe(0);
  });

  it('fast-forward ではコミットもレーンも増えない', () => {
    const before = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
    ]);
    const after = run(before, 'git merge feature').state;

    expect(layoutGraph(after).nodes).toHaveLength(2);
    expect(layoutGraph(after).lanes).toBe(1);
  });
});

describe('どの枝からも指されていないコミット', () => {
  it('detached HEAD で作ったコミットも並べられる', () => {
    const base = play(['git init', 'git commit -m one', 'git commit -m two']);
    const root = idOf(base, 'one');
    const state = play([
      'git init',
      'git commit -m one',
      'git commit -m two',
      `git checkout ${root}`,
      'git commit -m 迷子',
    ]);

    const rows = at(state);
    expect(rows[idOf(state, '迷子')]).toBeDefined();
    expect(rows[idOf(state, '迷子')].lane).not.toBe(rows[idOf(state, 'two')].lane);
  });

  it('枝を消しても、コミットは並び続ける', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git checkout -b feature',
      'git commit -m 枝',
      'git switch main',
      // まだ取り込んでいない枝なので、-d では断られる。-D が要る
      'git branch -D feature',
    ]);
    // 枝の名前が外れただけで、コミット 2 つはどちらも残る
    expect(Object.keys(state.commits)).toHaveLength(2);
    expect(layoutGraph(state).nodes).toHaveLength(2);
  });
});
