/**
 * Git のシミュレータが持つデータ。
 *
 * ここは UI から完全に独立させる。react も next も DOM API も import しない。
 * 各コマンドは「状態 → 新しい状態」を返す純粋関数で、状態は必ずイミュータブルに更新する。
 * そうしておくと、undo/redo もレベルの合格判定も、状態を配列に積むだけで済む。
 */

/** コミット 1 つ。parents が 2 つならマージコミット。 */
export interface Commit {
  /** 7 桁の 16 進。本物の SHA-1 ではなく、見た目だけ似せた識別子。 */
  id: string;
  /** 親のコミット id。最初のコミットだけ空になる。 */
  parents: string[];
  message: string;
  author: string;
  /** state.seq 由来の単調増加値。Date.now() は使わない（再現性のため）。 */
  createdAt: number;
  /**
   * このコミットが記録したパス。
   *
   * reset がこれを使う ― 取り消したコミットに入っていた変更を、
   * ステージへ戻すのか（--soft）、作業ディレクトリへ戻すのか（--mixed）、
   * 捨てるのか（--hard）は、「何が入っていたか」が分からないと決められない。
   */
  paths: string[];
}

/** ブランチとタグは「名前 → コミット」の対応でしかない。 */
export interface Ref {
  name: string;
  target: string;
}

/**
 * HEAD は「いまどこにいるか」を指す動的なポインタ。
 *
 * branch のときは名前を指す（コミットすると、その枝ごと前へ進む）。
 * detached のときはコミットを直に指す（コミットしても、どの枝も動かない）。
 *
 * `git init` の直後は type:'branch' ref:'main' だが、branches に main は**まだ無い**。
 * これが実際の Git の unborn HEAD で、最初のコミットが main を生む。
 */
export type Head = { type: 'branch'; ref: string } | { type: 'detached'; oid: string };

/**
 * ファイルの状態。中身は持たず、「Git から見てどの段階にあるか」だけを持つ。
 *   untracked … 一度もコミットされていない新しいファイル
 *   modified  … コミット済みだが、そのあと変更された
 *   staged    … 次のコミットに含めると決めた（index にある）
 */
export type FileStatus = 'untracked' | 'modified' | 'staged';

export interface FileState {
  path: string;
  status: FileStatus;
}

/**
 * 退避した作業。
 *
 * stash は 3 領域だけを動かし、コミットは 1 つも作らない。
 * 「コミットせずに片付ける」という、履歴に出ない操作があることを見せるために持つ。
 */
export interface StashEntry {
  /** state.seq 由来。新しいものほど大きい。 */
  id: number;
  message: string;
  index: FileState[];
  workingDir: FileState[];
  /** どのコミットの上で退避したか。 */
  base: string | null;
}

/**
 * もう 1 つのリポジトリ。
 *
 * 手元とは別の入れ物として持つ。これが要点で、
 * **fetch するまで、向こうのコミットはこちらのグラフに存在しない**。
 * 「見えていないだけ」ではなく「まだ持っていない」を、そのまま表す。
 */
export interface Remote {
  name: string;
  url: string;
  /** 向こうが持っているコミット。fetch でこちらへ複製される。 */
  commits: Record<string, Commit>;
  branches: Ref[];
}

/** HEAD が動いた記録。reset をやらかしたあとの復元（フェーズ5）で効いてくる。 */
export interface ReflogEntry {
  seq: number;
  /** 移動前のコミット。unborn からの移動なら null。 */
  from: string | null;
  /** 移動後のコミット。 */
  to: string | null;
  /** 'commit' / 'checkout' など、何をした結果か。 */
  op: string;
  message: string;
}

/**
 * コマンドが書き換えた領域。
 * 3 領域パネルが「どこが変わったか」を光らせるために使う。
 * どのコマンドがどこを触るのかは、このサイトがいちばん見せたいことなので、
 * UI ではなくコアの返り値として持たせる。
 */
export type Area = 'workingDir' | 'index' | 'repo' | 'head';

export interface RepoState {
  /** `git init` を済ませたか。false のうちはほとんどのコマンドが断る。 */
  initialized: boolean;
  commits: Record<string, Commit>;
  branches: Ref[];
  tags: Ref[];
  head: Head;
  /** ステージ（index）。 */
  index: FileState[];
  workingDir: FileState[];
  /** 一度でもコミットされたことのあるパス。untracked と modified を区別するために持つ。 */
  tracked: string[];
  /** 退避した作業。新しいものが末尾（stash@{0} は最後の要素）。 */
  stash: StashEntry[];
  remotes: Remote[];
  /**
   * リモート追跡ブランチ（origin/main など）。
   *
   * 「最後に fetch / push したとき、向こうの枝がどこを指していたか」の記録で、
   * 自分では動かない。ここが古いままなのが、pull を忘れた状態。
   */
  remoteBranches: Ref[];
  reflog: ReflogEntry[];
  /** id の採番と createdAt の元になる単調カウンタ。Math.random() は使わない。 */
  seq: number;
}

/** コマンドの返り値。エラーのときは state を素通しして、何も壊さない。 */
export interface CommandResult {
  state: RepoState;
  /** ターミナルに出す行。日本語で書く。 */
  log: string[];
  /** 実行できなかった理由。ある場合 state は入力と同一。 */
  error?: string;
  touched: Area[];
}
