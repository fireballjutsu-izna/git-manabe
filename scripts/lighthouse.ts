import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import lighthouse from 'lighthouse';
import { serveStatic } from './serve.ts';

/**
 * Lighthouse を通す。
 *
 * 書き出した out/ をそのまま配って測る ― 開発サーバではなく、
 * GitHub Pages に載るのと同じものを見たいため。
 * 落ちたときだけ、詳細をレポートとして artifacts/ に残す。
 */

const PORT = 4360;
const BASE = `http://127.0.0.1:${PORT}/git-manabe`;

/**
 * ここを下回ったら失敗にする。
 *
 * accessibility / best-practices / seo は、走らせる機械が変わっても答えが変わらない
 * 種類の検査なので 100 を必須にする。
 *
 * performance だけは 85 に置いてある。Lighthouse の既定はモバイル相当
 * （CPU 4 倍スロットリング・低速回線）で、出る数字が走らせた機械の速さに引っぱられる。
 * 90 を求めると、コードは何も変わっていないのに CI が赤くなる日が出る。
 * ここで捕まえたいのは「重いものを足してしまった」という退行なので、
 * 実測（88〜92）より少し下に線を引いて、ぶれでは落ちないようにする。
 */
const FLOOR: Record<string, number> = {
  performance: 0.85,
  accessibility: 1,
  'best-practices': 1,
  seo: 1,
};

/**
 * 見るページと、performance の下限。
 *
 * サンドボックスとレベルだけ低いのは、手を抜いているからではなく、
 * **端末エミュレータ（xterm、322 KB）を載せているページだから**。
 * これはこのサイトの主役なので、外して軽くするという選択肢が無い。
 * 読みものと同じ線を引いても、直しようのない赤が出続けるだけになる。
 */
const PAGES: { path: string; performance?: number }[] = [
  { path: '/' },
  { path: '/start/' },
  { path: '/docs/' },
  { path: '/docs/areas/' },
  { path: '/levels/', performance: 0.8 },
  { path: '/scenarios/' },
  { path: '/sandbox/', performance: 0.8 },
];

function findChromium(): string | undefined {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  const preinstalled = '/opt/pw-browsers/chromium';
  return existsSync(preinstalled) ? preinstalled : undefined;
}

const failures: string[] = [];

const server = await serveStatic(join(process.cwd(), 'out'), PORT);
const executablePath = findChromium();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  // Lighthouse は DevTools プロトコルで繋ぐので、ポートを開けておく
  args: ['--no-sandbox', '--remote-debugging-port=9222'],
});

try {
  for (const { path, performance } of PAGES) {
    const floors = { ...FLOOR, ...(performance !== undefined ? { performance } : {}) };
    const result = await lighthouse(
      `${BASE}${path}`,
      { port: 9222, output: 'html', logLevel: 'error' },
      undefined,
    );
    if (!result) {
      failures.push(`${path}: 測れませんでした`);
      continue;
    }

    const scores: string[] = [];
    for (const [key, floor] of Object.entries(floors)) {
      const score = result.lhr.categories[key]?.score ?? 0;
      const ok = score >= floor;
      if (!ok) failures.push(`${path} の ${key}: ${Math.round(score * 100)}（${floor * 100} 以上が必要）`);
      scores.push(`${ok ? ' ' : '!'}${key} ${Math.round(score * 100)}`);
    }
    console.log(`${failures.length === 0 ? '  ok  ' : '      '} ${path.padEnd(12)} ${scores.join(' / ')}`);

    // 満点でない項目は、何が引っかかったのかをその場で出す
    for (const [key] of Object.entries(floors)) {
      const cat = result.lhr.categories[key];
      if (!cat || cat.score === 1) continue;
      for (const ref of cat.auditRefs) {
        const audit = result.lhr.audits[ref.id];
        if (!audit || audit.score === null || audit.score >= 1 || ref.weight === 0) continue;
        console.log(`        [${key}] ${audit.title}（${audit.displayValue ?? ''}）`);
      }
    }

    if (failures.length > 0) {
      mkdirSync(join(process.cwd(), 'artifacts'), { recursive: true });
      const file = join(process.cwd(), 'artifacts', `lighthouse${path.replace(/\//g, '_')}.html`);
      writeFileSync(file, result.report as string);
      console.log(`        詳細: ${file}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 件が基準を下回りました。`);
  for (const f of failures) console.error(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log('\nすべて基準を満たしました。');
}
