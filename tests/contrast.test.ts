import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 配色のコントラスト比を、CSS そのものから測って検査する。
 *
 * 色は「なんとなく見やすい」で決めると、テーマを片方だけ触ったときに
 * もう片方が静かに読めなくなる。実際、最初の実装ではライトの枠線が
 * 1.36:1 しかなく、カードが背景から分離していなかった。
 * ここで測っておけば、次に色をいじった人が気づける。
 */

const CSS = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf-8');

/** `--name: value;` を 1 つのブロックから拾う。 */
function readBlock(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`${selector} が globals.css にありません`);
  const end = CSS.indexOf('\n}', start);
  const body = CSS.slice(start, end);

  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

const base = readBlock(':root');
const lightOverrides = readBlock(":root[data-theme='light']");
const light = { ...base, ...lightOverrides };

/** var(--x) を実際の色まで辿る。 */
function resolve(tokens: Record<string, string>, name: string): string {
  let value = tokens[name];
  if (value === undefined) throw new Error(`${name} が見つかりません`);
  for (let depth = 0; depth < 5; depth += 1) {
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    if (!ref) return value;
    value = tokens[ref[1]];
    if (value === undefined) throw new Error(`${name} の参照先 ${ref[1]} が見つかりません`);
  }
  throw new Error(`${name} の var() が深すぎます`);
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`16 進の色ではありません: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** WCAG の相対輝度。 */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 検査する組み合わせ。
 *   7.0 … 本文として読む文字
 *   4.5 … 補助テキストと見出し
 *   3.0 … 枠線・グラフの線など、文字ではないが情報を担うもの
 */
const RULES: { fg: string; bg: string; min: number; what: string }[] = [
  { fg: '--text', bg: '--bg', min: 7, what: '本文' },
  { fg: '--text', bg: '--bg-elev', min: 7, what: 'カードの上の本文' },
  { fg: '--text-muted', bg: '--bg', min: 4.5, what: '補助テキスト' },
  { fg: '--text-muted', bg: '--bg-elev', min: 4.5, what: 'カードの上の補助テキスト' },
  { fg: '--accent', bg: '--bg', min: 4.5, what: '見出し' },
  { fg: '--accent', bg: '--bg-elev', min: 4.5, what: 'カードの上の見出し' },
  { fg: '--area-working', bg: '--bg-elev', min: 4.5, what: '作業ディレクトリの見出し' },
  { fg: '--area-index', bg: '--bg-elev', min: 4.5, what: 'ステージの見出し' },
  { fg: '--area-repo', bg: '--bg-elev', min: 4.5, what: 'リポジトリの見出し' },
  { fg: '--border', bg: '--bg', min: 3, what: '枠線' },
  { fg: '--border', bg: '--bg-elev', min: 3, what: 'カードの枠線' },
  { fg: '--border-lit', bg: '--bg', min: 3, what: '強い枠線' },
  { fg: '--commit', bg: '--bg-sunken', min: 3, what: 'コミットの丸' },
  { fg: '--commit-dim', bg: '--bg-sunken', min: 3, what: 'グラフの辺' },
  { fg: '--branch', bg: '--bg-sunken', min: 3, what: 'ブランチのラベル' },
  { fg: '--head', bg: '--bg-sunken', min: 3, what: 'HEAD のラベル' },
  { fg: '--tag', bg: '--bg-sunken', min: 3, what: 'タグのラベル' },
  { fg: '--detached', bg: '--bg-sunken', min: 3, what: 'detached HEAD のラベル' },
];

describe.each([
  ['ダーク', base],
  ['ライト', light],
])('%s テーマのコントラスト', (_name, tokens) => {
  it.each(RULES)('$what（$fg / $bg）が $min:1 以上', ({ fg, bg, min }) => {
    const ratio = contrast(resolve(tokens, fg), resolve(tokens, bg));
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(min);
  });
});

describe('テーマの取りこぼし', () => {
  it('ライトでも、検査に使う色がすべて解決できる', () => {
    for (const { fg, bg } of RULES) {
      expect(() => resolve(light, fg), fg).not.toThrow();
      expect(() => resolve(light, bg), bg).not.toThrow();
    }
  });

  it('ライトはネオン 5 色をすべて上書きしている', () => {
    // 1 色でも上書きし忘れると、白い背景にダーク用の明るい色が残って読めなくなる
    for (const name of [
      '--neon-cyan',
      '--neon-violet',
      '--neon-lime',
      '--neon-amber',
      '--neon-rose',
    ]) {
      expect(lightOverrides[name], name).toBeDefined();
    }
  });
});
