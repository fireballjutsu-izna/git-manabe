/**
 * Git のシミュレータが持つデータ。
 *
 * ここは UI から完全に独立させる。react も next も DOM API も import しない。
 * 各コマンドは「状態 → 新しい状態」を返す純粋関数で、状態は必ずイミュータブルに更新する。
 * そうしておくと、undo/redo もレベルの合格判定も、状態を配列に積むだけで済む。
 */

/**
 * ファイルの中身。教育用に、短い行の配列だけを扱う。
 *
 * 中身を持たない頃は「どのパスが変わったか」しか分からず、
 * git diff が作れず、コンフリクトもファイル単位でしか起こせなかった。
 */
export type Content = string[];

/** ある時点の全ファイル。本物の git の tree にあたる。 */
export type Tree = Record<string, Content>;

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
  /** そのコミット時点の全ファイル。 */
  tree: Tree;
  /**
   * このコミットが記録したパス。
   *
   * **第一親の tree との差から導く**。addCommit が必ず計算するので、
   * tree とずれることはない（2 つを別々に持つと、必ずどこかでずれる）。
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
 *   untracked  … 一度もコミットされていない新しいファイル
 *   modified   … コミット済みだが、そのあと変更された
 *   staged     … 次のコミットに含めると決めた（index にある）
 *   conflicted … マージの両側が同じパスを変えていて、決着がついていない
 */
export type FileStatus = 'untracked' | 'modified' | 'staged' | 'conflicted';

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
  /** 退避したときのファイルの中身。 */
  work: Tree;
  stage: Tree;
  /** どのコミットの上で退避したか。 */
  base: string | null;
}

/** ぶつかったファイル 1 件。片側を選び直せるように、両側の中身を取っておく。 */
export interface ConflictFile {
  path: string;
  /** こちら側（HEAD）の中身。 */
  ours: Content;
  /** 取り込もうとしている側の中身。 */
  theirs: Content;
}

/**
 * 途中で止まっている作業。
 *
 * コンフリクトは「Git が勝手に決められなかった」というだけの状態で、
 * 壊れているわけではない。だからこそ**途中で止まる**という形にする ―
 * 決着をつける（add）か、なかったことにする（--abort）まで、ここに居続ける。
 *
 * 止まるのは merge だけではない。実務でいちばん痛いのは
 * **rebase の途中で止まること**なので、3 つとも同じ形で扱う。
 * 続け方だけが違う:
 *
 *   merge        続ける: git commit              やめる: git merge --abort
 *   rebase       続ける: git rebase --continue   やめる: git rebase --abort
 *   cherry-pick  続ける: git cherry-pick --continue  やめる: git cherry-pick --abort
 */
export interface Pausing {
  kind: 'merge' | 'rebase' | 'cherry-pick';
  /** ユーザーが打った取り込み相手の名前。表示にだけ使う。 */
  from: string;
  /** いま当てようとしているコミット。merge ではマージコミットの 2 番目の親になる。 */
  theirs: string;
  /** 分かれた地点（merge）／当てているコミットの親（rebase・cherry-pick）。 */
  base: string | null;
  /** 両側が変えていて、決着がついていないファイル。 */
  conflicts: ConflictFile[];
  /** --abort で戻すための、止まる前の状態。 */
  saved: {
    index: FileState[];
    workingDir: FileState[];
    work: Tree;
    stage: Tree;
    head: Head;
    /** 枝の上にいたなら、その枝が指していた先。 */
    branchTarget: string | null;
  };
  /** rebase・cherry-pick で、まだ当てていないコミット（古い順）。 */
  remaining: string[];
  /** これまでに作り直したコミットの対応（元 → 複製）。 */
  done: { before: string; after: string }[];
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
  /**
   * 作業ディレクトリのファイルの中身。path → 行。
   *
   * workingDir（FileState[]）が「どのファイルが、どういう状態か」を持つのに対し、
   * こちらは中身そのもの。git diff とコンフリクトの目印は、こちらから作る。
   */
  work: Tree;
  /** ステージの中身。コミットすると、これがそのまま tree になる。 */
  stage: Tree;
  /** merge・rebase・cherry-pick が途中で止まっているなら、その情報。 */
  pausing: Pausing | null;
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
