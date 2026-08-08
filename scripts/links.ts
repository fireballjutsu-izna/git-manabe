import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 書き出した out/ の中の、すべての内部リンクを辿る。
 *
 * ソースを読むのではなく**出力を読む**のが要点。
 * Markdown の [題](/docs/areas) は素の <a> になり、basePath が付かない。
 * ソース上は正しく見えるのに、本番だけ 404 になる ―
 * この種の切れ方は、出力を見ないと捕まらない。
 */

const ROOT = join(process.cwd(), 'out');
const BASE = '/git-manabe';

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...htmlFiles(path));
    else if (name.endsWith('.html')) out.push(path);
  }
  return out;
}

/** そのパスが out/ の中に実在するか。trailingSlash: true の書き出しに合わせる。 */
function resolves(path: string): boolean {
  const rel = path.slice(BASE.length) || '/';
  const target = join(ROOT, rel);
  if (existsSync(target) && statSync(target).isDirectory()) {
    return existsSync(join(target, 'index.html'));
  }
  return existsSync(target) || existsSync(`${target}.html`);
}

const problems: string[] = [];
let checked = 0;

for (const file of htmlFiles(ROOT)) {
  const html = readFileSync(file, 'utf8');
  const page = relative(ROOT, file);

  for (const [, href] of html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
    if (href.startsWith('#') || href.startsWith('mailto:')) continue;

    if (href.startsWith('http')) continue; // 外部は数えるだけ

    checked += 1;

    if (!href.startsWith(BASE)) {
      // ここがいちばん起きやすい。next/link を通していない内部リンク
      problems.push(`${page}: ${href} … basePath（${BASE}）が付いていません`);
      continue;
    }
    if (!resolves(href.split(/[?#]/)[0])) {
      problems.push(`${page}: ${href} … その行き先がありません`);
    }
  }
}

console.log(`内部リンク ${checked} 本を、${htmlFiles(ROOT).length} 枚のページから辿りました。`);

if (problems.length > 0) {
  console.error(`\n${problems.length} 本が切れています。`);
  for (const p of problems) console.error(`  ${p}`);
  process.exitCode = 1;
} else {
  console.log('切れているリンクはありません。');
}
