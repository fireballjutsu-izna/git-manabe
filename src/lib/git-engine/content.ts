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

/** touch した直後の中身。2 行あると、差分が「変わった行」と「そのまま の行」に分かれて見える。 */
export function defaultContent(path: string): Content {
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

export interface MergedContent {
  /** undefined は「そのパスは結果に無い」＝ どちらかが消した、の意味。 */
  content: Content | undefined;
  conflicted: boolean;
}

/**
 * 同じファイルの 3 つの版（分かれた地点・こちら・あちら）を 1 つにする。
 *
 * 片側しか変えていなければ、その側を採る ― これが「勝手にマージされた」の正体で、
 * ぶつからないほうが普通だということを、まず動きで見せたい。
 *
 * 両側が変えていても、**違う行**なら両方入る。同じ行だとそこで初めて止まる。
 * ファイル単位で見ていた頃は、この区別ができなかった。
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
  if (sameContent(ours, theirs)) return { content: ours, conflicted: false };
  // 片側が触っていない ＝ もう片側の言うとおりにする
  if (sameContent(base, ours)) return { content: theirs, conflicted: false };
  if (sameContent(base, theirs)) return { content: ours, conflicted: false };

  // 片方が消して、片方が変えた。どちらを採るかは決められない
  if (!ours || !theirs) {
    return {
      content: conflictBlock(ours ?? ['（削除）'], theirs ?? ['（削除）'], oursLabel, theirsLabel),
      conflicted: true,
    };
  }

  // 行数が揃っているなら、行ごとに見る。ぶつかった行だけを目印で囲む
  if (base && base.length === ours.length && base.length === theirs.length) {
    return mergeLineByLine(base, ours, theirs, oursLabel, theirsLabel);
  }

  // 行数が変わっているときは、素朴に丸ごとぶつける。
  // 本物の git ももう少し粘るが、教材としては「両方見せて選ばせる」で足りる
  return { content: conflictBlock(ours, theirs, oursLabel, theirsLabel), conflicted: true };
}

function mergeLineByLine(
  base: Content,
  ours: Content,
  theirs: Content,
  oursLabel: string,
  theirsLabel: string,
): MergedContent {
  const out: Content = [];
  let conflicted = false;

  // ぶつかった行が続くときは、1 つの塊にまとめる（目印だらけにしない）
  let runOurs: string[] = [];
  let runTheirs: string[] = [];
  const flush = (): void => {
    if (runOurs.length === 0) return;
    out.push(...conflictBlock(runOurs, runTheirs, oursLabel, theirsLabel));
    runOurs = [];
    runTheirs = [];
  };

  for (let i = 0; i < base.length; i += 1) {
    const b = base[i];
    const o = ours[i];
    const t = theirs[i];

    if (o === t) {
      flush();
      out.push(o);
    } else if (o === b) {
      flush();
      out.push(t);
    } else if (t === b) {
      flush();
      out.push(o);
    } else {
      conflicted = true;
      runOurs.push(o);
      runTheirs.push(t);
    }
  }
  flush();

  return { content: out, conflicted };
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
