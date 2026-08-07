import { create } from 'zustand';
import {
  canRedo,
  canUndo,
  emptyState,
  initHistory,
  pushHistory,
  redo,
  resetHistory,
  run,
  undo,
  type CommandResult,
  type History,
  type RepoState,
} from '@/lib/git-engine';

/** ターミナルに出す 1 行。種類で色を変える。 */
export interface OutputLine {
  id: number;
  kind: 'input' | 'output' | 'error' | 'note';
  text: string;
}

interface RepoStore {
  history: History<RepoState>;
  /** 直前のコマンドの結果。3 領域パネルのハイライトに使う。 */
  lastResult: CommandResult | null;
  /**
   * 同じ領域を続けて触ったときにも光らせ直すための番号。
   * touched の中身だけ見ていると、2 回続けて add したときに再生されない。
   */
  pulse: number;
  output: OutputLine[];

  runLine: (line: string) => CommandResult;
  undoStep: () => void;
  redoStep: () => void;
  resetAll: () => void;
  clearOutput: () => void;

  canUndo: () => boolean;
  canRedo: () => boolean;
}

let lineId = 0;
const nextLineId = (): number => {
  lineId += 1;
  return lineId;
};

/**
 * シミュレータとの配線だけを持つ。
 * 状態遷移・undo/redo の中身は git-engine 側の純粋関数がやる。
 */
export const useRepoStore = create<RepoStore>((set, get) => ({
  history: initHistory(emptyState()),
  lastResult: null,
  pulse: 0,
  output: [],

  runLine: (line) => {
    const history = get().history;
    const result = run(history.present, line);

    const lines: OutputLine[] = [{ id: nextLineId(), kind: 'input', text: line }];
    for (const text of result.log) {
      lines.push({ id: nextLineId(), kind: result.error ? 'error' : 'output', text });
    }

    set((s) => ({
      // 失敗したコマンドは履歴に積まない。undo が「打ち間違いを 1 回戻す」で
      // 消費されてしまうと、本当に戻したい 1 手に届かなくなる。
      history: result.error ? s.history : pushHistory(s.history, result.state),
      lastResult: result,
      pulse: result.touched.length > 0 ? s.pulse + 1 : s.pulse,
      output: [...s.output, ...lines],
    }));

    return result;
  },

  undoStep: () => {
    set((s) => {
      if (!canUndo(s.history)) return s;
      return {
        history: undo(s.history),
        lastResult: null,
        output: [...s.output, { id: nextLineId(), kind: 'note', text: '1 手戻しました。' }],
      };
    });
  },

  redoStep: () => {
    set((s) => {
      if (!canRedo(s.history)) return s;
      return {
        history: redo(s.history),
        lastResult: null,
        output: [...s.output, { id: nextLineId(), kind: 'note', text: '1 手やり直しました。' }],
      };
    });
  },

  resetAll: () => {
    set({
      history: resetHistory(emptyState()),
      lastResult: null,
      pulse: 0,
      output: [
        { id: nextLineId(), kind: 'note', text: '最初から始めます。git init を実行してください。' },
      ],
    });
  },

  clearOutput: () => set({ output: [] }),

  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),
}));

/** いまの RepoState だけが欲しいときの近道。 */
export const useRepoState = (): RepoState => useRepoStore((s) => s.history.present);
