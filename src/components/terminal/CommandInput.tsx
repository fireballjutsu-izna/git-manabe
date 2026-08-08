'use client';

import { useRef, useState } from 'react';
import { useRepoStore } from '@/store/repo';

/**
 * コマンドを打つための、素の入力欄。
 *
 * xterm にも直接打てるが、**スマートフォンではスペースが入らない**。
 * 仮想キーボード（Gboard など）は入力中の文字を変換候補として抱えていて、
 * スペースキーをその「確定」に使う。確定した文字だけが送られ、
 * スペースそのものは文字として届かない ―
 * xterm 側の入力経路では、これを回避する手立てが無い。
 *
 * だから入力だけ、ふつうの <input> でも受けられるようにする。
 * ここなら変換も空白もブラウザが面倒を見てくれる。
 * xterm は出力を見せる側に専念させる。
 */
export function CommandInput() {
  const runLine = useRepoStore((s) => s.runLine);
  const [line, setLine] = useState('');
  /** 打ったコマンド。↑↓ で呼び戻す。 */
  const history = useRef<string[]>([]);
  /** 0 が「入力中」で、負の数だけ遡る。 */
  const position = useRef(0);

  const submit = (): void => {
    const text = line.trim();
    if (!text) return;
    history.current.push(text);
    position.current = 0;
    runLine(text);
    setLine('');
  };

  /** 履歴を n 個ぶん遡る（n が負なら戻る）。 */
  const recall = (step: number): void => {
    const next = position.current + step;
    if (next > 0 || -next > history.current.length) return;
    position.current = next;
    setLine(next === 0 ? '' : history.current[history.current.length + next]);
  };

  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="command-input" className="sr-only">
        git コマンドを入力
      </label>
      <input
        id="command-input"
        value={line}
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            recall(-1);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            recall(1);
          }
        }}
        // 端末への入力なので、機械的なお節介は全部切る
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="git status"
        className="min-w-0 flex-1 rounded border border-line bg-sunken px-3 py-2 font-mono text-sm text-fg placeholder:text-muted"
      />
      <button
        type="submit"
        disabled={line.trim() === ''}
        className="shrink-0 rounded border border-line-lit px-4 py-2 text-sm text-fg enabled:hover:border-cyan-neon disabled:opacity-40"
      >
        実行
      </button>
    </form>
  );
}
