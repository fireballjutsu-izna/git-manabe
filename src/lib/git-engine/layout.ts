import type { RepoState } from './types';

/**
 * コミット DAG を、格子の上に並べる。
 *
 * dagre や React Flow のような汎用の階層レイアウトは使わない。
 * Git のグラフは「1 本の枝が 1 本のレーンを占める」という見え方が直感に合っていて、
 * 汎用レイアウトだと枝が途中でレーンを乗り換えてしまい、目で追えなくなるため。
 *
 * 並べ方は git log --graph や IDE の Git Graph と同じで、
 * **上から下へ 1 行 1 コミット、レーンは横に並ぶ**。
 *
 * 返すのは格子の座標（行・レーン）だけ。ピクセルへの変換は描画側の仕事にする。
 */

export interface GraphNode {
  id: string;
  /** 何行目か。0 が最上段＝いちばん新しいコミット。 */
  row: number;
  /** 何番目のレーンか。だいたい「何本目の枝か」。 */
  lane: number;
}

export interface GraphEdge {
  /** 親のコミット id。 */
  from: string;
  /** 子のコミット id。 */
  to: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 行の数 ＝ コミットの数（0 のときはコミットが 1 つも無い）。 */
  rows: number;
  /** レーンの数。 */
  lanes: number;
}

/**
 * 上から下へ並べる順番。新しいものが上。
 *
 * createdAt は state.seq 由来の単調増加値で、親は必ず子より先に作られる。
 * つまり降順に並べるだけで「子が親より上」というトポロジ順になり、
 * わざわざ深さ優先で辿り直す必要がない。
 *
 * git log（commands/log.ts）も同じ並びを使っている。
 * グラフと log の行が食い違うと、突き合わせて読めなくなる。
 */
function orderedRows(state: RepoState): string[] {
  return Object.values(state.commits)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
    .map((c) => c.id);
}

/**
 * レーンを割り当てる順番を決める。
 *
 * 同じリポジトリなら常に同じ並びになるようにする（毎回レーンが入れ替わると、
 * commit のたびにグラフ全体が飛び跳ねて、アニメーションが読めなくなる）。
 * main / master を必ず先頭に置くのは、そこがいちばん左（レーン 0）に来てほしいから。
 */
function orderedTips(state: RepoState): string[] {
  const tips: string[] = [];
  const push = (id: string | null | undefined): void => {
    if (id && state.commits[id] && !tips.includes(id)) tips.push(id);
  };

  const primary = state.branches.filter((b) => b.name === 'main' || b.name === 'master');
  const others = state.branches.filter((b) => b.name !== 'main' && b.name !== 'master');
  for (const b of primary) push(b.target);
  for (const b of others) push(b.target);

  if (state.head.type === 'detached') push(state.head.oid);
  for (const t of state.tags) push(t.target);

  // どの ref からも指されていない先端（枝を消したあとなど）も拾う
  const hasChild = new Set<string>();
  for (const c of Object.values(state.commits)) {
    for (const p of c.parents) hasChild.add(p);
  }
  const leftovers = Object.values(state.commits)
    .filter((c) => !hasChild.has(c.id))
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const c of leftovers) push(c.id);

  return tips;
}

export function layoutGraph(state: RepoState): GraphLayout {
  const ids = Object.keys(state.commits);
  if (ids.length === 0) return { nodes: [], edges: [], rows: 0, lanes: 0 };

  const lane: Record<string, number> = {};
  const assigned = new Set<string>();

  /*
   * レーンは流れごとに 1 本ずつ与え、**詰めない**。
   *
   * 空いていれば同じレーンに載せる、という詰め方もできる（そのほうが横に狭い）。
   * だがそれをやると、無関係な 2 つの区間が同じレーンに並び、
   * しかもレーンの色まで同じになるので、1 本の連続した流れに見えてしまう。
   * 横に広がるほうが、嘘の連続に見えるよりずっとよい。
   */
  let nextLane = 0;

  for (const tip of orderedTips(state)) {
    // 先端から第一親をたどり、まだレーンが決まっていない範囲だけを取る。
    // 途中で既に割り当て済みのコミットに合流したら、そこで止める
    // ― 合流点から先は、先に通った枝のレーンに属している。
    const chain: string[] = [];
    let cursor: string | undefined = tip;
    while (cursor && state.commits[cursor] && !assigned.has(cursor)) {
      chain.push(cursor);
      cursor = state.commits[cursor].parents[0];
    }
    // 何も残っていない先端はレーンを消費しない。
    // fast-forward のあとのように、2 つの枝が同じコミットを指しているときがこれ。
    if (chain.length === 0) continue;

    const l = nextLane;
    nextLane += 1;
    for (const id of chain) {
      lane[id] = l;
      assigned.add(id);
    }
  }

  const nodes: GraphNode[] = orderedRows(state).map((id, row) => ({
    id,
    row,
    lane: lane[id] ?? 0,
  }));

  const edges: GraphEdge[] = [];
  for (const id of ids) {
    for (const parent of state.commits[id].parents) {
      if (state.commits[parent]) edges.push({ from: parent, to: id });
    }
  }

  return {
    nodes,
    edges,
    rows: nodes.length,
    lanes: Math.max(...nodes.map((n) => n.lane)) + 1,
  };
}
