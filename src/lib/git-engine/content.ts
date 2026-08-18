import type { ConflictFile, Content, Tree } from './types';

/*
 * ファイルの中身を、行の配列として扱う。
 *
 * ここまでは「どのパスが変わったか」しか持っていなかったので、
 * git diff が作れず、コンフリクトも**ファイル単位**でしか起こせなかった。
 * 行を持つと、この 2 つが本物と同じ形になる。
 *
 * 教材なので、扱うのは短い行の配列だけ。文字単位の差分までは踏み込まない。
 */

/** touch した直後の中身。2 行あると、差分が「変わった行」と「そのままの行」に分かれて見える。 */
export function defaultContent(path: string): Content {
  // .gitignore は 1 行 1 パターンのファイル。既定の説明行を入れると、
  // それ自体がパターンとして読まれてしまう
  if (path === '.gitignore') return ['# Git に見せないもの'];
  return [path, '（ここに中身を書きます）'];
}

/** tree を、行の配列まで含めて複製する。 */
export function copyTree(tree: Tree): Tree {
  const out: Tree = {};
  for (const [path, content] of Object.entries(tree)) out[path] = [...content];
  return out;
}

export function sameContent(a: Content | undefined, b: Content | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/** 2 つの tree で中身の違うパス（片方にしか無いものも含む）。 */
export function changedPaths(before: Tree, after: Tree): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].filter((p) => !sameContent(before[p], after[p])).sort();
}

/* ---- コンフリクトの目印 ---- */

export const OURS_MARK = '<<<<<<<';
export const SPLIT_MARK = '=======';
export const THEIRS_MARK = '>>>>>>>';

/** 目印がまだ残っているか。決着をつけずに add しようとしたときに止めるのに使う。 */
export function hasConflictMarkers(content: Content | undefined): boolean {
  return (content ?? []).some(
    (line) =>
      line.startsWith(OURS_MARK) || line === SPLIT_MARK || line.startsWith(THEIRS_MARK),
  );
}

function conflictBlock(
  ours: Content,
  theirs: Content,
  oursLabel: string,
  theirsLabel: string,
): Content {
  return [
    `${OURS_MARK} ${oursLabel}`,
    ...ours,
    SPLIT_MARK,
    ...theirs,
    `${THEIRS_MARK} ${theirsLabel}`,
  ];
}

/* ---- 3 つの中身を 1 つにする ---- */

/**
 * ぶつかった 1 か所が、どういうぶつかり方をしたか。
 *
 * 「止まった」だけを伝えても、次に何をすればいいか分からない。
 * 本物の git も modify/delete と content を言い分けているので、こちらも分ける。
 */
export type ConflictKind =
  /** 片側がファイルごと消し、もう片側は中身を変えた。 */
  | 'file-deleted'
  /** 片側が消した行を、もう片側が変えた。 */
  | 'line-deleted'
  /** 両側が、同じ場所に別々の行を足した。 */
  | 'both-added'
  /** 両側が、同じ行を別々の中身にした。 */
  | 'same-line'
  /** 別々の行だが、隣り合っていて切り分けられない。 */
  | 'nearby';

export interface MergedContent {
  /** undefined は「そのパスは結果に無い」＝ どちらかが消した、の意味。 */
  content: Content | undefined;
  conflicted: boolean;
  /** ぶつかった箇所のぶつかり方（前から順に）。ぶつかっていなければ空。 */
  kinds: ConflictKind[];
}

/**
 * 同じファイルの 3 つの版（分かれた地点・こちら・あちら）を 1 つにする。
 *
 * 片側しか変えていなければ、その側を採る ― これが「勝手にマージされた」の正体で、
 * ぶつからないほうが普通だということを、まず動きで見せたい。
 *
 * 両側が変えていても、**離れた行**なら両方入る。行数が増えても減っても同じ ―
 * base からの変更を行のかたまり（ハンク）で捉えて、重ならないものは並べて入れる。
 */
export function mergeContent(
  base: Content | undefined,
  ours: Content | undefined,
  theirs: Content | undefined,
  oursLabel: string,
  theirsLabel: string,
): MergedContent {
  /*
   * ここで undefined を「空のファイル」に丸めてはいけない。
   * 消したことと、中身が空になったことは別で、
   * 空配列を残すと次のマージで「片方が消した」として必ずぶつかる。
   */
  if (sameContent(ours, theirs)) return { content: ours, conflicted: false, kinds: [] };
  // 片側が触っていない ＝ もう片側の言うとおりにする
  if (sameContent(base, ours)) return { content: theirs, conflicted: false, kinds: [] };
  if (sameContent(base, theirs)) return { content: ours, conflicted: false, kinds: [] };

  // 片方が消して、片方が変えた。どちらを採るかは決められない
  if (!ours || !theirs) {
    return {
      content: conflictBlock(ours ?? ['（削除）'], theirs ?? ['（削除）'], oursLabel, theirsLabel),
      conflicted: true,
      kinds: ['file-deleted'],
    };
  }

  // base がまだ無い（両側が別々に作った）ときは、空から足したものとして扱う
  return mergeHunks(base ?? [], ours, theirs, oursLabel, theirsLabel);
}

/** base の [start, end) を lines で置き換える、という 1 つの変更。start === end なら足しただけ。 */
interface Hunk {
  start: number;
  end: number;
  lines: Content;
}

/** base から side への変更を、行のかたまりに分ける。 */
function hunksOf(base: Content, side: Content): Hunk[] {
  const hunks: Hunk[] = [];
  let pos = 0;
  let current: Hunk | null = null;

  for (const d of diffLines(base, side)) {
    if (d.op === ' ') {
      // 変わっていない行が 1 行でも挟まれば、そこでかたまりは切れる
      current = null;
      pos += 1;
      continue;
    }
    if (!current) {
      current = { start: pos, end: pos, lines: [] };
      hunks.push(current);
    }
    if (d.op === '-') {
      pos += 1;
      current.end = pos;
    } else {
      current.lines.push(d.text);
    }
  }

  return hunks;
}

/** base の [start, end) に、その範囲のハンクを当てた結果。 */
function applyHunks(base: Content, hunks: Hunk[], start: number, end: number): Content {
  const out: Content = [];
  let pos = start;
  for (const h of hunks) {
    out.push(...base.slice(pos, h.start));
    out.push(...h.lines);
    pos = h.end;
  }
  out.push(...base.slice(pos, end));
  return out;
}

function kindOf(
  ourHunks: Hunk[],
  theirHunks: Hunk[],
  ourText: Content,
  theirText: Content,
): ConflictKind {
  if (ourText.length === 0 || theirText.length === 0) return 'line-deleted';
  // 両側とも「足しただけ」なら、消された行も書き換えられた行も無い
  if ([...ourHunks, ...theirHunks].every((h) => h.start === h.end)) return 'both-added';

  const sameRange =
    ourHunks[0].start === theirHunks[0].start &&
    ourHunks[ourHunks.length - 1].end === theirHunks[theirHunks.length - 1].end;
  return sameRange ? 'same-line' : 'nearby';
}

/**
 * base からの変更どうしを突き合わせて、重ならないものは両方入れる。
 *
 * 重なりの判定は本物の git（xdiff）に合わせて、**触れ合ったら重なり**とする ―
 * 変更と変更の間に、変わっていない行が 1 行も無ければぶつける。
 * 実際、隣り合う行を両側で変えると本物の git も止まるので、
 * ここを「範囲が交わったときだけ」に緩めると本物より通してしまう。
 */
function mergeHunks(
  base: Content,
  ours: Content,
  theirs: Content,
  oursLabel: string,
  theirsLabel: string,
): MergedContent {
  const oursHunks = hunksOf(base, ours);
  const theirsHunks = hunksOf(base, theirs);

  const out: Content = [];
  const kinds: ConflictKind[] = [];
  let pos = 0;
  let oi = 0;
  let ti = 0;

  while (oi < oursHunks.length || ti < theirsHunks.length) {
    const takeOurs =
      ti >= theirsHunks.length ||
      (oi < oursHunks.length && oursHunks[oi].start <= theirsHunks[ti].start);
    const first = takeOurs ? oursHunks[oi] : theirsHunks[ti];
    const start = first.start;
    let end = first.end;

    const ourGroup: Hunk[] = [];
    const theirGroup: Hunk[] = [];
    if (takeOurs) {
      ourGroup.push(oursHunks[oi]);
      oi += 1;
    } else {
      theirGroup.push(theirsHunks[ti]);
      ti += 1;
    }

    // 触れ合っているものを、伸びなくなるまで取り込む
    for (;;) {
      let grew = false;
      while (oi < oursHunks.length && oursHunks[oi].start <= end) {
        end = Math.max(end, oursHunks[oi].end);
        ourGroup.push(oursHunks[oi]);
        oi += 1;
        grew = true;
      }
      while (ti < theirsHunks.length && theirsHunks[ti].start <= end) {
        end = Math.max(end, theirsHunks[ti].end);
        theirGroup.push(theirsHunks[ti]);
        ti += 1;
        grew = true;
      }
      if (!grew) break;
    }

    out.push(...base.slice(pos, start));
    pos = end;

    // 片側しか触っていない範囲は、そのまま採る ― これがいちばん多い
    if (theirGroup.length === 0) {
      out.push(...applyHunks(base, ourGroup, start, end));
      continue;
    }
    if (ourGroup.length === 0) {
      out.push(...applyHunks(base, theirGroup, start, end));
      continue;
    }

    const ourText = applyHunks(base, ourGroup, start, end);
    const theirText = applyHunks(base, theirGroup, start, end);
    // 同じ場所を、たまたま同じ中身にしていた。決められないことは何も無い
    if (sameContent(ourText, theirText)) {
      out.push(...ourText);
      continue;
    }

    kinds.push(kindOf(ourGroup, theirGroup, ourText, theirText));
    out.push(...conflictBlock(ourText, theirText, oursLabel, theirsLabel));
  }

  out.push(...base.slice(pos));

  return { content: out, conflicted: kinds.length > 0, kinds };
}

/** 書き込まれた目印から、両側の中身を取り出す。1 ファイルに何か所あってもいい。 */
export interface ConflictBlock {
  ours: Content;
  theirs: Content;
}

export function conflictBlocks(content: Content | undefined): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  let current: ConflictBlock | null = null;
  let side: 'ours' | 'theirs' = 'ours';

  for (const line of content ?? []) {
    if (line.startsWith(OURS_MARK)) {
      current = { ours: [], theirs: [] };
      side = 'ours';
    } else if (line === SPLIT_MARK && current) {
      side = 'theirs';
    } else if (line.startsWith(THEIRS_MARK) && current) {
      blocks.push(current);
      current = null;
    } else if (current) {
      current[side].push(line);
    }
  }

  return blocks;
}

export interface MergedTree {
  tree: Tree;
  conflicts: ConflictFile[];
}

/**
 * tree ごと 3 つを 1 つにする。
 *
 * merge・rebase・cherry-pick・revert は、どれも「3 つの版を 1 つにする」という
 * 同じ操作でできている。違うのは base / ours / theirs に何を入れるかだけなので、
 * 入口はここ 1 つにまとめる。
 */
export function mergeTrees(
  base: Tree,
  ours: Tree,
  theirs: Tree,
  oursLabel: string,
  theirsLabel: string,
): MergedTree {
  const paths = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])];
  const tree: Tree = {};
  const conflicts: ConflictFile[] = [];

  for (const path of paths.sort()) {
    const merged = mergeContent(base[path], ours[path], theirs[path], oursLabel, theirsLabel);
    // 消えたファイルは、結果にも残さない
    if (merged.content === undefined) continue;

    tree[path] = merged.content;
    if (merged.conflicted) {
      conflicts.push({ path, ours: ours[path] ?? [], theirs: theirs[path] ?? [] });
    }
  }

  return { tree, conflicts };
}

/* ---- 差分 ---- */

export type DiffOp = ' ' | '+' | '-';

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * 2 つの中身の行差分。
 *
 * 素朴な LCS。1 ファイル数行の教材なので、これで十分に速い。
 */
export function diffLines(before: Content, after: Content): DiffLine[] {
  const n = before.length;
  const m = after.length;

  // lcs[i][j] … before の i 行目以降と after の j 行目以降で、共通に取れる最大の行数
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ op: ' ', text: before[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: '-', text: before[i] });
      i += 1;
    } else {
      out.push({ op: '+', text: after[j] });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ op: '-', text: before[i] });
    i += 1;
  }
  while (j < m) {
    out.push({ op: '+', text: after[j] });
    j += 1;
  }

  return out;
}

/** 1 ファイルぶんの差分を、git diff と同じ見た目の行にする。 */
export function formatFileDiff(
  path: string,
  before: Content | undefined,
  after: Content | undefined,
): string[] {
  if (sameContent(before, after)) return [];

  const lines = [`diff --git a/${path} b/${path}`];
  if (!before) lines.push('new file');
  else if (!after) lines.push('deleted file');
  lines.push(`--- ${before ? `a/${path}` : '/dev/null'}`);
  lines.push(`+++ ${after ? `b/${path}` : '/dev/null'}`);

  for (const d of diffLines(before ?? [], after ?? [])) {
    lines.push(`${d.op}${d.text}`);
  }
  return lines;
}
