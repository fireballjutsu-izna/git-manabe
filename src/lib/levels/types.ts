import type { RepoState } from '@/lib/git-engine';

/**
 * レベル 1 つ。
 *
 * サンドボックスは自由に触る場所で、レベルは**目的地のある場所**。
 * 「何を打てばいいか分からない」で止まる人に、1 つずつ課題を渡す。
 */
export interface Level {
  id: string;
  title: string;
  /** 何を練習するのか。1〜2 文。 */
  intro: string;
  /** 何をすれば合格なのか。人に読ませる文。 */
  task: string;
  /** 開始状態を作るコマンド。ユーザーが打つ前に流しておく。 */
  setup: string[];
  /**
   * 目標の状態を作るコマンド。
   * ここから「形」を計算し、それと一致すれば合格。
   * 同じ形に着けば手順は問わない。
   */
  goal?: string[];
  /**
   * 形では表せない条件。
   * ステージの中身や stash のように、DAG の形に出ないものを見る。
   */
  check?: (state: RepoState) => boolean;
  /** 上から順に開いていくヒント。 */
  hints: string[];
}

export interface LevelResult {
  passed: boolean;
  /** 何が満たせていないか。合格していれば空。 */
  missing: string[];
}
