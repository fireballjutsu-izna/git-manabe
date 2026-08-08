import type { RepoState } from './types';

/*
 * .gitignore。
 *
 * 本物と同じで、**ただのファイル**として扱う。専用の設定領域は持たない。
 * 中身を持つようになったので、作業ディレクトリの .gitignore をそのまま読める。
 *
 * 本物の書式はもっと広い（否定 !、途中の / の有無、** など）。
 * ここで扱うのは、実務で 9 割方これで足りる 3 つだけ:
 *
 *   .env        名前がそのまま一致
 *   *.key       拡張子で一致
 *   secrets/    そのディレクトリの下ぜんぶ
 *
 * # から始まる行と空行は読み飛ばす。
 */

/** .gitignore に書かれたパターン。作業ディレクトリのものを読む。 */
export function ignorePatterns(state: RepoState): string[] {
  const content = state.work['.gitignore'] ?? state.stage['.gitignore'];
  if (!content) return [];
  return content
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/** そのパスが、1 つでもパターンに当たるか。 */
export function matchesIgnore(path: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesOne(path, p));
}

function matchesOne(path: string, pattern: string): boolean {
  // secrets/ … そのディレクトリの下ぜんぶ
  if (pattern.endsWith('/')) return path.startsWith(pattern);

  // *.key … 拡張子で一致
  if (pattern.startsWith('*.')) return path.endsWith(pattern.slice(1));

  // それ以外は名前がそのまま一致。ディレクトリの中でも、末尾の名前で見る
  const base = path.slice(path.lastIndexOf('/') + 1);
  return path === pattern || base === pattern;
}

/**
 * いま Git がそのパスを無視するか。
 *
 * **すでに追跡しているファイルには効かない**のが、いちばん大事なところ。
 * 「.gitignore に書いたのに、まだ差分に出てくる」で詰まるのは全部これで、
 * 追跡から外す（git rm --cached）まで無視は始まらない。
 */
export function isIgnored(state: RepoState, path: string): boolean {
  /*
   * 判定の基準は「一度でもコミットされたか（tracked）」ではなく、
   * **いまステージに載っているか**。本物の git も index を見る。
   *
   * この違いが git rm --cached で効く ―
   * ステージから外した瞬間、履歴には残っていても無視が始まる。
   * tracked で見ていると、コミットするまで無視が始まらない。
   */
  if (state.stage[path] !== undefined) return false;
  return matchesIgnore(path, ignorePatterns(state));
}

/**
 * 作業ディレクトリの untracked / ignored を付け直す。
 *
 * .gitignore は**あとから書かれる**。書いた瞬間に、すでに手元にある
 * untracked のファイルが ignored に変わらないと、書いた意味が伝わらない。
 * 逆に .gitignore から行を消せば、また見えるようになる。
 *
 * コマンドごとに気を配ると必ずどこかで忘れるので、run() の出口で一括してやる。
 * modified / staged / conflicted には触らない ―
 * すでに追跡しているファイルに .gitignore は効かないため。
 */
export function refreshIgnored(state: RepoState): RepoState {
  const patterns = ignorePatterns(state);
  if (patterns.length === 0 && !state.workingDir.some((f) => f.status === 'ignored')) {
    return state;
  }

  let changed = false;
  const workingDir = state.workingDir.map((f) => {
    if (f.status !== 'untracked' && f.status !== 'ignored') return f;
    const want = isIgnored(state, f.path) ? 'ignored' : 'untracked';
    if (want === f.status) return f;
    changed = true;
    return { ...f, status: want as typeof f.status };
  });

  return changed ? { ...state, workingDir } : state;
}
