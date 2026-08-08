import type { RepoState } from '@/lib/git-engine';

/**
 * シナリオ。
 *
 * レベルが「概念 1 つの練習」なのに対して、こちらは**仕事 1 つ**。
 * 花屋（こえだ花店）の依頼という形をとるが、打つのは実務どおりの git で、
 * 場面のほうだけを花屋の言葉にしてある。
 *
 * レベルの課題文は「親が 2 つのコミットを作ってください」という**形の指示**で、
 * 何をすればいいかは分かっても、なぜそうしたいのかが無い。
 * 実務では理由が先にあるので、そこを埋めるのがシナリオの役割。
 */

export interface ScenarioStep {
  /** 誰から来た依頼か。'店長' / '先輩' / '本店' */
  from: string;
  /** 花屋の言葉での依頼。チャットのように積み上げて出す。 */
  message: string;
  /**
   * git として何をするのか。
   * 比喩が勝ちすぎて手が止まったときのために、必ず素で書いておく。
   */
  task: string;
  /**
   * 達成条件。
   *
   * レベルと違って「途中の状態」を見るので、goal（目標の形との一致）ではなく
   * 関数に統一している。ステップごとに目標のコマンド列を書くのは冗長になるため。
   */
  check: (state: RepoState) => boolean;
  hints: string[];
  /** 模範解答の手数。星の基準で、テストで実測と突き合わせる。 */
  par: number;
  /** コマンドボタンに出す名前。課題文と食い違わせないために書き写す。 */
  suggest?: { file?: string; branch?: string };
}

export interface Scenario {
  id: string;
  /** 花屋の言葉での題。 */
  title: string;
  /** git として何の練習か。題だけでは分からないので必ず添える。 */
  subtitle: string;
  intro: string;
  /** 開始状態を作るコマンド。 */
  setup: string[];
  steps: ScenarioStep[];
  /** 使う概念。記事（DOCS）の id を並べる。 */
  uses: string[];
}

/** いまどこまで進んだか。 */
export interface ScenarioProgress {
  /** 満たし終えたステップの数。steps.length と同じなら完了。 */
  done: number;
  /** 全部満たしたか。 */
  finished: boolean;
}

/**
 * 手数から星を決める。
 *
 * 「同じ形に着けば手順は問わない」という判定なので、
 * 遠回りでも通る。そこに最短手を探す遊びを足す。
 */
export function starsFor(moves: number, par: number): number {
  if (moves <= par) return 3;
  if (moves <= par + 2) return 2;
  return 1;
}
