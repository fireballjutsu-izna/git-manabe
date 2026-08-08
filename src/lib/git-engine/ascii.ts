import { layoutGraph } from './layout';
import type { RepoState } from './types';

/*
 * `git log --graph` の、あの縦線。
 *
 * 画面のグラフとは別に、ターミナルにも出せるようにする。
 * 本物を触るときに最初に見るのはこちらなので、
 * **同じ履歴が 2 通りの見え方で並ぶ**ことに意味がある ―
 * 左の * と | が、右の丸と線と同じものだと分かれば、実物へそのまま渡せる。
 *
 *   *   f32d61f (HEAD -> main) Merge spring into main
 *   |\
 *   | * ea2d53c (spring) 春の花に替えた
 *   * | e52d4bf 店長が生け直した
 *   |/
 *   *   eb2d556 開店
 */

/** 1 レーンぶんの横幅。本物と同じで「印 + 空白」の 2 文字。 */
const LANE = 2;

export interface GraphRow {
  /** そのコミット。 */
  id: string;
  /** 行の左に付ける絵。'* | ' のような文字列。 */
  art: string;
  /**
   * この行の**下**に挟む連結線。'|\\' や '|/'。
   * 枝分かれと合流のところにだけ出る（要らない行では空文字）。
   */
  connector: string;
}

/**
 * 出すコミットだけでレーンを引き直して、行ごとの絵を作る。
 *
 * layoutGraph をそのまま使う ― 画面のグラフとレーンの決め方が違うと、
 * 同じ履歴なのに 2 つの絵で枝の並びが変わってしまう。
 * 出さないコミットを落とした state を渡して、その部分だけを組ませる。
 */
export function asciiGraph(state: RepoState, shown: string[]): GraphRow[] {
  const keep = new Set(shown);
  const commits = Object.fromEntries(
    Object.entries(state.commits).filter(([id]) => keep.has(id)),
  );
  const layout = layoutGraph({ ...state, commits });
  if (layout.nodes.length === 0) return [];

  const row = new Map(layout.nodes.map((n) => [n.id, n.row]));
  const lane = new Map(layout.nodes.map((n) => [n.id, n.lane]));
  const byRow = [...layout.nodes].sort((a, b) => a.row - b.row);

  /*
   * 1 本の線が使う列。
   *
   * 幹から外れているほう（レーン番号の大きいほう）を使う。
   * 枝分かれなら子の側、合流なら 2 番目の親の側で、どちらもこれで当たる。
   * 斜めになるのは、外れているほうと反対側の端の 1 段だけ。
   */
  const lines = layout.edges.map((e) => {
    const fromRow = row.get(e.from) as number;
    const toRow = row.get(e.to) as number;
    const fromLane = lane.get(e.from) as number;
    const toLane = lane.get(e.to) as number;
    return {
      column: Math.max(fromLane, toLane),
      /** 上（新しい側）の行。 */
      top: toRow,
      /** 下（古い側）の行。 */
      bottom: fromRow,
      /** 上の端で列が変わる ＝ 合流。下向きに開く \ を描く */
      opensAtTop: toLane < Math.max(fromLane, toLane),
      /** 下の端で列が変わる ＝ 枝分かれ。上向きに閉じる / を描く */
      closesAtBottom: fromLane < Math.max(fromLane, toLane),
    };
  });

  const width = layout.lanes;

  /*
   * 1 レーンは 2 文字ぶん。縦線と印はレーンの頭（2c 文字目）に、
   * 斜線はその 1 つ手前（2c-1 文字目）に置く。
   * こうすると本物と同じ「|\」「|/」の並びになる ―
   * 均等に空けると「| \」になって、どこへ繋がる線なのか読めなくなる。
   */
  const draw = (marks: { at: number; ch: string }[]): string => {
    const cells = new Array<string>(width * LANE).fill(' ');
    for (const m of marks) if (m.at >= 0) cells[m.at] = m.ch;
    return cells.join('');
  };

  return byRow.map((node) => {
    const marks: { at: number; ch: string }[] = [];

    // 通り抜けていく線。両端の行そのものには引かない（そこは印か斜線）
    for (const l of lines) {
      if (l.top < node.row && node.row < l.bottom) marks.push({ at: l.column * LANE, ch: '|' });
    }
    marks.push({ at: node.lane * LANE, ch: '*' });

    // この行の下に挟む斜線
    const below: { at: number; ch: string }[] = [];
    let needed = false;
    for (const l of lines) {
      if (l.opensAtTop && l.top === node.row) {
        below.push({ at: l.column * LANE - 1, ch: '\\' });
        needed = true;
      } else if (l.closesAtBottom && l.bottom === node.row + 1) {
        below.push({ at: l.column * LANE - 1, ch: '/' });
        needed = true;
      } else if (l.top <= node.row && l.bottom >= node.row + 1) {
        below.push({ at: l.column * LANE, ch: '|' });
      }
    }

    return {
      id: node.id,
      art: draw(marks),
      connector: needed ? draw(below).trimEnd() : '',
    };
  });
}
