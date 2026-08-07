'use client';

import { useState } from 'react';
import { currentBranchName, headCommitId } from '@/lib/git-engine';
import { useRepoStore } from '@/store/repo';

/**
 * ボタンから同じコマンドを打てるようにする。
 *
 * 狭い画面では xterm への打ち込みが現実的でないのと、
 * 「次に何を打てばいいか分からない」で止まる人がいちばん多いため、
 * いまの状態から意味のある候補だけを出す。
 */
export function CommandButtons() {
  const state = useRepoStore((s) => s.history.present);
  const runLine = useRepoStore((s) => s.runLine);
  const [nameSeq, setNameSeq] = useState(0);

  const head = headCommitId(state);
  const branch = currentBranchName(state);

  const suggestions: { label: string; line: string; hint?: string }[] = [];

  if (!state.initialized) {
    suggestions.push({ label: 'git init', line: 'git init', hint: 'ここから始まります' });
  } else {
    const file = `file-${state.tracked.length + state.workingDir.length + 1}.txt`;
    suggestions.push({ label: `touch ${file}`, line: `touch ${file}`, hint: '変更を 1 つ作る' });

    if (state.workingDir.length > 0) {
      suggestions.push({ label: 'git add .', line: 'git add .', hint: 'ステージへ移す' });
    }

    suggestions.push({
      label: 'git commit',
      line: `git commit -m "${state.index.length > 0 ? 'ステージの変更' : 'コミット'}${
        Object.keys(state.commits).length + 1
      }"`,
      hint: '木を 1 つ伸ばす',
    });

    if (head) {
      const name = `feature-${String.fromCharCode(97 + (state.branches.length + nameSeq) % 26)}`;
      suggestions.push({
        label: `git branch ${name}`,
        line: `git branch ${name}`,
        hint: 'いまのコミットに名前を付ける',
      });

      for (const b of state.branches) {
        if (b.name === branch) continue;
        suggestions.push({ label: `git switch ${b.name}`, line: `git switch ${b.name}` });
      }

      if (state.head.type === 'detached' && state.branches.length > 0) {
        suggestions.push({
          label: `git switch ${state.branches[0].name}`,
          line: `git switch ${state.branches[0].name}`,
          hint: '枝に戻る',
        });
      }
    }

    suggestions.push({ label: 'git status', line: 'git status' });
    suggestions.push({ label: 'git log', line: 'git log' });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => {
            runLine(s.line);
            setNameSeq((n) => n + 1);
          }}
          title={s.hint ? `${s.line} — ${s.hint}` : s.line}
          className="rounded border border-line bg-elev px-2.5 py-1.5 text-left font-mono text-xs text-fg hover:border-cyan-neon hover:bg-tint-cyan"
        >
          {s.label}
          {s.hint && <span className="ml-2 font-sans text-[10px] text-muted">{s.hint}</span>}
        </button>
      ))}
    </div>
  );
}
