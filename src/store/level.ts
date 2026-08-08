import { create } from 'zustand';
import {
  emptyProgress,
  loadProgress,
  markCleared,
  markScenarioCleared,
  saveProgress,
  today,
  type Progress,
} from '@/lib/storage/progress';

interface ProgressStore {
  progress: Progress;
  /** localStorage を読み終えたか。読む前に「未クリア」と描くとちらつく。 */
  loaded: boolean;
  load: () => void;
  clear: (levelId: string) => void;
  /** シナリオを 1 本終えたときの記録。星と手数も残す。 */
  clearScenario: (id: string, stars: number, moves: number) => void;
  reset: () => void;
}

/**
 * 学習の記録。
 *
 * localStorage は window が無いと触れないので、
 * 描画が始まってから load() を呼ぶ。それまでは loaded:false で、
 * 「クリア済み」の印は出さない。
 */
export const useProgressStore = create<ProgressStore>((set, get) => ({
  progress: emptyProgress(),
  loaded: false,

  load: () => {
    if (get().loaded) return;
    set({ progress: loadProgress(), loaded: true });
  },

  clear: (levelId) => {
    const next = markCleared(get().progress, levelId, today());
    saveProgress(next);
    set({ progress: next });
  },

  clearScenario: (id, stars, moves) => {
    const next = markScenarioCleared(get().progress, id, stars, moves, today());
    saveProgress(next);
    set({ progress: next });
  },

  reset: () => {
    const next = emptyProgress();
    saveProgress(next);
    set({ progress: next });
  },
}));
