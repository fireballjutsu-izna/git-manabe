'use client';

import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useRepoStore, type OutputLine } from '@/store/repo';
import '@xterm/xterm/css/xterm.css';

const PROMPT = '\x1b[36m$\x1b[0m ';

/** xterm から届くキー。制御文字をそのまま書くと読めないので名前を付ける。 */
const KEY = {
  enter: '\r',
  newline: '\n',
  backspace: '\x7f',
  ctrlA: '\x01',
  ctrlC: '\x03',
  ctrlE: '\x05',
  ctrlL: '\x0c',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
} as const;

/**
 * 行の種類ごとの色。
 *
 * 256 色の番号を直に書くと、ライトテーマで文字が薄くなって読めなくなる。
 * 標準の 16 色だけを使い、その 16 色の中身を下の readTheme() が
 * テーマの CSS 変数から差し替える ― こうすると両方のテーマで自動的に合う。
 */
const COLOR: Record<OutputLine['kind'], string> = {
  input: '\x1b[39m', // 既定の文字色。打った本人の入力なので、いちばん濃く出す
  output: '\x1b[90m', // brightBlack ＝ --text-muted
  error: '\x1b[31m', // red ＝ --neon-rose
  note: '\x1b[32m', // green ＝ --neon-lime
};

/** CSS 変数から xterm の配色を作る。テーマを切り替えたら読み直す。 */
function readTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  const muted = v('--text-muted', '#9a9ab0');
  return {
    background: v('--bg-sunken', '#07070e'),
    foreground: v('--text', '#e8e8f2'),
    cursor: v('--neon-cyan', '#4fd6ff'),
    selectionBackground: v('--border-lit', '#3a3a5c'),
    red: v('--neon-rose', '#ff6b8a'),
    green: v('--neon-lime', '#7cf5a0'),
    cyan: v('--neon-cyan', '#4fd6ff'),
    brightBlack: muted,
    brightRed: v('--neon-rose', '#ff6b8a'),
    brightGreen: v('--neon-lime', '#7cf5a0'),
    brightCyan: v('--neon-cyan', '#4fd6ff'),
  };
}

/** 印字できる 1 文字か（エスケープ列や制御文字を弾く）。 */
function isPrintable(data: string): boolean {
  return !data.startsWith('\x1b') && data >= ' ' && data !== '\x7f';
}

export default function TerminalView() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", monospace',
      fontSize: 13,
      lineHeight: 1.5,
      theme: readTheme(),
      // 学習用の画面なので、遡れる量は控えめでよい
      scrollback: 800,
    });
    /*
     * Tab はターミナルに渡さず、ブラウザに任せる。
     *
     * xterm は既定で Tab を文字として飲み込むので、
     * キーボードだけで操作している人がここへ入ると**二度と出られない**
     * ― WCAG 2.1.2（キーボードトラップ）に真正面から当たる。
     * このサイトの git にはタブ補完が無いので、渡さなくて困ることは何もない。
     */
    term.attachCustomKeyEventHandler((event) => event.key !== 'Tab');

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    // xterm が作る入力欄のラベルは "Terminal input" の固定文字列。
    // 実際にフォーカスが乗るのはここなので、日本語に付け替える。
    host
      .querySelector('textarea.xterm-helper-textarea')
      ?.setAttribute('aria-label', 'git コマンドを打ちます。結果は下に読み上げられます');

    /** 入力中の行と、その中でのカーソル位置。 */
    let buffer = '';
    let cursor = 0;
    /** 打ったコマンドの履歴。position は 0 が「入力中」で、負の数だけ遡る。 */
    const history: string[] = [];
    let position = 0;
    /** すでに画面へ書いた出力の件数。ここから先だけを書き足す。 */
    let written = 0;

    const redraw = (): void => {
      term.write(`\r\x1b[K${PROMPT}${buffer}`);
      const back = buffer.length - cursor;
      if (back > 0) term.write(`\x1b[${back}D`);
    };

    /** ストアに増えた出力を、まだ書いていないぶんだけ書き足す。 */
    const flush = (): void => {
      const output = useRepoStore.getState().output;
      if (output.length < written) {
        // リセットされたので、画面も戻す
        term.clear();
        written = 0;
      }
      for (let i = written; i < output.length; i += 1) {
        const line = output[i];
        const body = line.kind === 'input' ? `${PROMPT}${line.text}` : `  ${line.text}`;
        term.write(`\r\x1b[K${COLOR[line.kind]}${body}\x1b[0m\r\n`);
      }
      written = output.length;
    };

    const submit = (): void => {
      const line = buffer;
      buffer = '';
      cursor = 0;
      position = 0;

      // 入力中の行はいったん消す。打った内容も含めて、
      // 画面への書き出しはストアの出力から一本化して描く。
      term.write('\r\x1b[K');

      if (!line.trim()) {
        term.write(PROMPT);
        return;
      }
      history.push(line);
      useRepoStore.getState().runLine(line);
    };

    const insert = (text: string): void => {
      buffer = buffer.slice(0, cursor) + text + buffer.slice(cursor);
      cursor += text.length;
    };

    /** ↑↓ で打ったコマンドを呼び戻す。 */
    const recall = (delta: number): void => {
      if (history.length === 0) return;
      position = Math.min(0, Math.max(-history.length, position + delta));
      buffer = position === 0 ? '' : history[history.length + position];
      cursor = buffer.length;
    };

    const onData = term.onData((data) => {
      // 貼り付けなど、複数文字が一度に届くことがある
      if (data.length > 1 && !data.startsWith('\x1b')) {
        for (const ch of data) {
          if (ch === KEY.enter || ch === KEY.newline) submit();
          else if (isPrintable(ch)) insert(ch);
        }
        redraw();
        return;
      }

      switch (data) {
        case KEY.enter:
        case KEY.newline:
          submit();
          return;

        case KEY.backspace:
          if (cursor === 0) return;
          buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
          cursor -= 1;
          break;

        case KEY.ctrlC:
          term.write('^C\r\n');
          buffer = '';
          cursor = 0;
          break;

        case KEY.ctrlL:
          term.clear();
          break;

        case KEY.up:
          recall(-1);
          break;

        case KEY.down:
          recall(1);
          break;

        case KEY.left:
          cursor = Math.max(0, cursor - 1);
          break;

        case KEY.right:
          cursor = Math.min(buffer.length, cursor + 1);
          break;

        case KEY.ctrlA:
          cursor = 0;
          break;

        case KEY.ctrlE:
          cursor = buffer.length;
          break;

        default:
          if (!isPrintable(data)) return;
          insert(data);
      }
      redraw();
    });

    // 途中から開いた場合に備えて、いまある出力を書いてからプロンプトを出す
    flush();
    term.write(PROMPT);

    // ボタン UI から実行されたコマンドも、ここを通って画面に出る
    const unsubscribe = useRepoStore.subscribe(() => {
      flush();
      redraw();
    });

    const resize = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* 画面から外れている最中は測れないことがある */
      }
    });
    resize.observe(host);

    const themeWatcher = new MutationObserver(() => {
      term.options.theme = readTheme();
    });
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      onData.dispose();
      unsubscribe();
      resize.disconnect();
      themeWatcher.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="h-72 w-full overflow-hidden rounded-card border border-line bg-sunken p-2"
      aria-label="git コマンドを打つターミナル"
    />
  );
}
