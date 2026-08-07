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
function coords(state: RepoState): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of layoutGraph(state).nodes) out[n.id] = { x: n.x, y: n.y };
  return out;
}

function idOf(state: RepoState, message: string): string {
  const commit = Object.values(state.commits).find((c) => c.message === message);
  if (!commit) throw new Error(`${message} というコミットがありません`);
  return commit.id;
}

describe('コミットが無いとき', () => {
  it('空のレイアウトを返す', () => {
    expect(layoutGraph(emptyState())).toEqual({ nodes: [], edges: [], cols: 0, lanes: 0 });
  });
});

describe('1 本の鎖', () => {
  it('世代がそのまま列になり、全部が同じレーンに乗る', () => {
    const state = play(['git init', 'git commit -m one', 'git commit -m two', 'git commit -m three']);
    const at = coords(state);

    expect(at[idOf(state, 'one')]).toEqual({ x: 0, y: 0 });
    expect(at[idOf(state, 'two')]).toEqual({ x: 1, y: 0 });
    expect(at[idOf(state, 'three')]).toEqual({ x: 2, y: 0 });

    const layout = layoutGraph(state);
    expect(layout.cols).toBe(3);
    expect(layout.lanes).toBe(1);
  });

  it('辺は親から子へ張られる', () => {
    const state = play(['git init', 'git commit -m one', 'git commit -m two']);
    expect(layoutGraph(state).edges).toEqual([
      { from: idOf(state, 'one'), to: idOf(state, 'two') },
    ]);
  });
});

describe('枝分かれ', () => {
  it('main はレーン 0 に残り、分かれた枝が別のレーンに乗る', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
    ]);
    const at = coords(state);

    expect(at[idOf(state, 'one')]).toEqual({ x: 0, y: 0 });
    expect(at[idOf(state, '幹の上')]).toEqual({ x: 1, y: 0 });
    expect(at[idOf(state, '枝の上')].x).toBe(1);
    expect(at[idOf(state, '枝の上')].y).toBeGreaterThan(0);

    expect(layoutGraph(state).lanes).toBe(2);
  });

  it('feature を先に伸ばしても、レーン 0 は main のもの', () => {
    // 枝の作成順ではなく名前で決まることを見る。
    // feature に先にコミットしてから main に戻って伸ばしても、main が下に残ってほしい。
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
    ]);
    const at = coords(state);
    expect(at[idOf(state, '根')].y).toBe(0);
    expect(at[idOf(state, '幹の上')].y).toBe(0);
    expect(at[idOf(state, '枝の上')].y).toBe(1);
  });

  it('ぶつからないうちは、レーンを増やさず親と同じ列に乗る', () => {
    // 分かれてはいるが main 側がまだ伸びていないので、見た目は 1 本の線でよい。
    // ここでレーンを増やすと、コミットするたびにグラフが跳ねて追えなくなる。
    const state = play([
      'git init',
      'git commit -m 根',
      'git checkout -b feature',
      'git commit -m 枝の上',
    ]);
    expect(layoutGraph(state).lanes).toBe(1);
  });

  it('枝が 3 本なら 3 レーンに分かれ、どれも重ならない', () => {
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
    const layout = layoutGraph(state);
    expect(layout.lanes).toBe(3);

    // 同じ (x, y) に 2 つのコミットが乗っていないこと
    const cells = layout.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('レーンの安定性', () => {
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
    const before = play([
      'git init',
      'git commit -m one',
      'git checkout -b feature',
      'git commit -m two',
    ]);
    const beforeAt = coords(before);

    const after = run(before, 'git commit -m three').state;
    const afterAt = coords(after);

    for (const id of Object.keys(beforeAt)) {
      expect(afterAt[id], id).toEqual(beforeAt[id]);
    }
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

    const at = coords(state);
    expect(at[idOf(state, '迷子')]).toBeDefined();
    expect(at[idOf(state, '迷子')].x).toBe(1);
    expect(at[idOf(state, '迷子')].y).not.toBe(at[idOf(state, 'two')].y);
  });

  it('枝を消しても、コミットは並び続ける', () => {
    const state = play([
      'git init',
      'git commit -m one',
      'git checkout -b feature',
      'git commit -m 枝',
      'git switch main',
      'git branch -d feature',
    ]);
    // 枝の名前が外れただけで、コミット 2 つはどちらも残る
    expect(Object.keys(state.commits)).toHaveLength(2);
    expect(layoutGraph(state).nodes).toHaveLength(2);
  });
});
