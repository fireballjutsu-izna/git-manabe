import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { serveStatic } from './serve.ts';

/**
 * アクセシビリティの検査。
 *
 * 見た目の検査（smoke）とは目的が違うので分けてある。
 * ここで見るのは「目で見ずに、手だけで、あるいは耳だけで使えるか」で、
 * 画面を見ている限り気づけない種類の壊れ方を捕まえる。
 *
 * 3 本立て:
 *   1. axe … WCAG の機械で判る部分（両テーマ・主要ページ・状態変化後）
 *   2. キーボード … トラップが無いか、輪が見えるか、スキップできるか
 *   3. 読み上げ … ターミナルの出力が文章として流れてくるか
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4340;
const ROOT = join(process.cwd(), 'out');
const BASE = `http://127.0.0.1:${PORT}/git-manabe`;
const PAGES = [
  '/',
  '/start/',
  '/docs/',
  '/docs/areas/',
  // 表・コードブロック・記事内リンクがいちばん多い 1 本を代表に選ぶ
  '/docs/reset-modes/',
  '/levels/',
  '/scenarios/',
  '/scenarios/hotfix/',
  '/sandbox/',
  '/levels/conflict/',
];

const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `  期待: ${JSON.stringify(expected)} / 実際: ${JSON.stringify(actual)}`}`,
  );
  if (!ok) failures.push(label);
}

interface AxeResult {
  violations: { id: string; impact: string; help: string; nodes: { target: string[]; html: string }[] }[];
}

async function axeScan(page: Page, label: string): Promise<void> {
  await page.addScriptTag({ content: AXE });
  const res = (await page.evaluate(async () => {
    // @ts-expect-error axe はページ側に注入している
    return await window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
    });
  })) as AxeResult;

  check(`axe ${label}`, res.violations.length, 0);
  for (const v of res.violations) {
    console.log(`        [${v.impact}] ${v.id}: ${v.help}（${v.nodes.length} 件）`);
    for (const n of v.nodes.slice(0, 3)) {
      console.log(`          ${n.target.join(' ')}`);
      console.log(`          ${n.html.slice(0, 140).replace(/\s+/g, ' ')}`);
    }
  }
}

/** いま focus が当たっている要素の、読み上げ名にあたる文字列。 */
const focusedName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return '(body)';
    return (el.getAttribute('aria-label') ?? el.innerText ?? el.tagName).trim().slice(0, 32);
  });

function findChromium(): string | undefined {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  const preinstalled = '/opt/pw-browsers/chromium';
  return existsSync(preinstalled) ? preinstalled : undefined;
}

async function open(browser: Browser, path: string, theme?: 'dark' | 'light'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  if (theme) {
    await page.evaluate((t) => {
      localStorage.setItem('git-manabe:theme', t);
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.waitForTimeout(300);
  }
  return page;
}

async function main(): Promise<void> {
  const server = await serveStatic(ROOT, PORT);
  const executablePath = findChromium();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox'],
  });

  try {
    // ---- 1. axe ----
    for (const theme of ['dark', 'light'] as const) {
      for (const path of PAGES) {
        const page = await open(browser, path, theme);
        await axeScan(page, `${theme} ${path}`);
        await page.close();
      }
    }

    // 止まっているマージとヒント展開は、初期表示には出てこない状態なので別に見る
    const paused = await open(browser, '/levels/conflict/');
    await paused.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });
    await paused.locator('textarea.xterm-helper-textarea').focus();
    await paused.keyboard.type('git merge feature');
    await paused.keyboard.press('Enter');
    await paused.waitForTimeout(1000);
    await paused.getByRole('button', { name: /ヒントを見る/ }).click();
    await paused.waitForTimeout(300);
    await axeScan(paused, 'コンフリクトで停止 + ヒント展開');
    await paused.close();

    // ---- 2. キーボード ----
    const kb = await open(browser, '/sandbox/');
    await kb.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });

    await kb.keyboard.press('Tab');
    check('最初の Tab は「本文へスキップ」', await focusedName(kb), '本文へスキップ');
    await kb.keyboard.press('Enter');
    await kb.waitForTimeout(200);
    check('スキップリンクが本文へ飛ぶ', new URL(kb.url()).hash, '#main');

    /*
     * ターミナルからキーボードで抜けられること。
     * xterm は既定で Tab を文字として飲み込むので、放っておくと
     * 入った人が二度と出られない（WCAG 2.1.2 キーボードトラップ）。
     */
    await kb.locator('textarea.xterm-helper-textarea').focus();
    await kb.keyboard.press('Tab');
    const forward = await focusedName(kb);
    check('ターミナルから Tab で前へ抜けられる', forward !== 'git コマンドを打ちます。結果は下に読み上げられます', true);
    await kb.locator('textarea.xterm-helper-textarea').focus();
    await kb.keyboard.press('Shift+Tab');
    const back = await focusedName(kb);
    check(
      'ターミナルから Shift+Tab で後ろへ抜けられる',
      back !== 'git コマンドを打ちます。結果は下に読み上げられます',
      true,
    );

    // フォーカスの輪が、既定まかせではなく自前で描かれていること
    const ring = await kb.evaluate(() => {
      const el = document.querySelector<HTMLElement>('header nav a')!;
      el.focus();
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle };
    });
    check('フォーカスの輪が 2px の実線', ring, { width: '2px', style: 'solid' });

    // キーボードだけでコマンドを実行できること
    const fresh = await open(browser, '/sandbox/');
    await fresh.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });
    let reached = false;
    for (let i = 0; i < 12; i += 1) {
      await fresh.keyboard.press('Tab');
      if ((await focusedName(fresh)).startsWith('git init')) {
        await fresh.keyboard.press('Enter');
        await fresh.waitForTimeout(600);
        reached = true;
        break;
      }
    }
    check('Tab と Enter だけで git init を実行できる', reached, true);
    check(
      '実行された（リポジトリができている）',
      (await fresh.locator('[data-pane="repo"]').innerText()).includes('まだリポジトリがありません'),
      false,
    );
    await fresh.close();
    await kb.close();

    // ---- 3. 読み上げ ----
    const sr = await open(browser, '/sandbox/');
    await sr.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });

    check(
      'ターミナルの入力欄が日本語で名乗る',
      await sr.locator('textarea.xterm-helper-textarea').getAttribute('aria-label'),
      'git コマンドを打ちます。結果は下に読み上げられます',
    );

    const status = sr.locator('[role="status"]');
    check('読み上げ用の領域がある', await status.count(), 1);

    await sr.locator('textarea.xterm-helper-textarea').focus();
    await sr.keyboard.type('git init', { delay: 3 });
    await sr.keyboard.press('Enter');
    await sr.waitForTimeout(500);
    const spoken = await status.innerText();
    check('打ったコマンドが読み上げに乗る', spoken.includes('git init'), true);
    check('その結果も読み上げに乗る', spoken.includes('空のリポジトリを作りました'), true);

    // 直前の 1 回ぶんだけにする（毎回、履歴を最初から読み直させない）
    await sr.locator('textarea.xterm-helper-textarea').focus();
    await sr.keyboard.type('touch a.txt', { delay: 3 });
    await sr.keyboard.press('Enter');
    await sr.waitForTimeout(500);
    const after = await status.innerText();
    check('読み上げは直前の 1 回ぶんだけ', after.includes('git init'), false);
    check('最新の結果になっている', after.includes('a.txt を作りました'), true);

    // 画面には出さない
    const box = await status.boundingBox();
    check('読み上げ用の領域は画面に出ない', (box?.height ?? 99) <= 2, true);
    await sr.close();
  } finally {
    await browser.close();
    await server.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} 件失敗しました。`);
    process.exitCode = 1;
  } else {
    console.log('\nすべて通りました。');
  }
}

await main();
