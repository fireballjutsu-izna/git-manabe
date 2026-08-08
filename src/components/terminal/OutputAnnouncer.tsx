'use client';

import { useRepoStore } from '@/store/repo';

/**
 * 直前のコマンドの結果を、読み上げに渡すためだけの領域。
 *
 * xterm の中身は canvas / div の格子で、読み上げソフトからは
 * 「1 文字ずつ並んだ何か」にしか見えない。xterm 自身の screenReaderMode も
 * あるが、行を英語圏の端末として読み上げる作りで、日本語の説明文には向かない。
 *
 * このサイトでは**ターミナルの出力こそが教材**なので、
 * 同じ内容を素のテキストとしてもう一度置き、polite で読ませる。
 * 画面には出さない（見える人には xterm の側が本体なので）。
 */
export function OutputAnnouncer() {
  const output = useRepoStore((s) => s.output);

  // 最後に打った入力から後ろが「直前の 1 回ぶん」。
  // 全部を読み上げると、コマンドのたびに履歴を最初から読み直すことになる。
  let start = -1;
  for (let i = output.length - 1; i >= 0; i -= 1) {
    if (output[i].kind === 'input') {
      start = i;
      break;
    }
  }
  const latest = start >= 0 ? output.slice(start) : output.slice(-4);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {/* 1 行ずつ別の要素にする。つなげて 1 文にすると、句点が二重になって読みが濁る */}
      {latest.map((line) => (
        <p key={line.id}>{line.text}</p>
      ))}
    </div>
  );
}
