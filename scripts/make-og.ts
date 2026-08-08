import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

/**
 * 共有時に出る画像（public/og.png）を作る。
 *
 * ビルドのたびに焼くのではなく、**一度作ってリポジトリに入れる**。
 * satori（next/og）で日本語を出すにはフォントを読み込ませる必要があり、
 * ビルドをネットワークとフォントの都合に縛られたくないため。
 * 見た目を変えたくなったら、ここを直して `npm run og` を実行し、
 * 出てきた png を一緒にコミットする。
 */

const OUT = join(process.cwd(), 'public', 'og.png');

// サイトの配色そのまま。ダーク側を使う
const HTML = `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    background: #0a0a12;
    color: #e8e8f2;
    font-family: system-ui, -apple-system, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif;
    letter-spacing: 0.02em;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 88px;
    position: relative;
    overflow: hidden;
  }
  .name { font-size: 92px; font-weight: 700; color: #4fd6ff; line-height: 1.1; }
  .tagline { font-size: 38px; color: #c9c9de; margin-top: 18px; }
  .lead { font-size: 26px; color: #9a9ab0; margin-top: 40px; line-height: 1.7; max-width: 640px; }
  .url { position: absolute; left: 88px; bottom: 56px; font-size: 20px; color: #62627a;
         font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

  /* 右側に、このサイトが見せているものをそのまま置く */
  svg { position: absolute; right: 64px; top: 50%; transform: translateY(-50%); }
</style>
<body>
  <div class="name">こえだ</div>
  <div class="tagline">動かして学ぶ Git</div>
  <div class="lead">git のコマンドを打つと、<br>コミットの木が目の前で育ちます。</div>
  <div class="url">fireballjutsu-izna.github.io/git-manabe</div>

  <svg width="380" height="420" viewBox="0 0 380 420" fill="none">
    <!-- main の一本道 -->
    <path d="M60 120 H180" stroke="#8ea2c8" stroke-width="3"/>
    <path d="M180 120 C230 120 230 260 280 260" stroke="#7fd4a8" stroke-width="3"/>
    <path d="M180 120 H300" stroke="#8ea2c8" stroke-width="3"/>

    <circle cx="60"  cy="120" r="16" fill="#0a0a12" stroke="#8ea2c8" stroke-width="3"/>
    <circle cx="180" cy="120" r="16" fill="#0a0a12" stroke="#8ea2c8" stroke-width="3"/>
    <circle cx="300" cy="120" r="16" fill="#0a0a12" stroke="#ffd166" stroke-width="3"/>
    <circle cx="280" cy="260" r="16" fill="#0a0a12" stroke="#7fd4a8" stroke-width="3"/>

    <rect x="242" y="60" width="116" height="30" rx="7" fill="#0a0a12" stroke="#ffd166" stroke-width="2"/>
    <text x="300" y="81" fill="#ffd166" font-size="15" font-family="ui-monospace, monospace" text-anchor="middle">HEAD → main</text>

    <rect x="228" y="310" width="104" height="30" rx="7" fill="#0a0a12" stroke="#4fd6ff" stroke-width="2"/>
    <text x="280" y="331" fill="#4fd6ff" font-size="15" font-family="ui-monospace, monospace" text-anchor="middle">feature</text>
  </svg>
</body>
</html>`;

function findChromium(): string | undefined {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  const preinstalled = '/opt/pw-browsers/chromium';
  return existsSync(preinstalled) ? preinstalled : undefined;
}

const executablePath = findChromium();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.setContent(HTML, { waitUntil: 'load' });
mkdirSync(join(process.cwd(), 'public'), { recursive: true });
await page.screenshot({ path: OUT });
await browser.close();

console.log(`${OUT} を書き出しました（1200×630）。一緒にコミットしてください。`);
