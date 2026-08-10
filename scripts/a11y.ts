import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
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
 *   1. axe … WCAG の機械で判る部分（両テーマ・全ページ・状態変化後）
 *   2. キーボード … トラップが無いか、輪が見えるか、スキップできるか
 *   3. 読み上げ … ターミナルの出力が文章として流れてくるか
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 4340;
const ROOT = join(process.cwd(), 'out');
const BASE = `http://127.0.0.1:${PORT}/git-manabe`;

/** 同時に開くページ数。1 枚ずつ開くと 90 枚で 3 分を超える。 */
const LANES = 4;

/**
 * 書き出した out/ に在るページ、全部。
 *
 * 代表を手で選んでいた時期があったが、記事を足すたびに同じ抜け方をした ―
 * 見出しの無い表が 8 本たまっていたのに、その記事がどれも一覧に無かった。
 * 一覧を書かなければ、書き忘れることもない。links と同じ考え方にする。
 */
function routes(dir: string = ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...routes(path));
    else if (name === 'index.html') {
      const rel = relative(ROOT, dir);
      out.push(rel ? `/${rel}/` : '/');
    }
  }
  return out.sort();
}

const PAGES = routes();

const failures: string[] = [];

/** 1 件ぶんの判定。落ちたぶんを控えて、表示する 1 行を返す。 */
function verdict(label: string, actual: unknown, expected: unknown): string {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(label);
  return `${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `  期待: ${JSON.stringify(expected)} / 実際: ${JSON.stringify(actual)}`}`;
}

function check(label: string, actual: unknown, expected: unknown): void {
  console.log(verdict(label, actual, expected));
}

interface AxeResult {
  violations: { id: string; impact: string; help: string; nodes: { target: string[]; html: string }[] }[];
}

async function violationsOf(page: Page): Promise<AxeResult['violations']> {
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
  return res.violations;
}

/** 破れた規則を、そのまま直せる形で並べる。 */
function detail(violations: AxeResult['violations']): string[] {
  const lines: string[] = [];
  for (const v of violations) {
    lines.push(`        [${v.impact}] ${v.id}: ${v.help}（${v.nodes.length} 件）`);
    for (const n of v.nodes.slice(0, 3)) {
      lines.push(`          ${n.target.join(' ')}`);
      lines.push(`          ${n.html.slice(0, 140).replace(/\s+/g, ' ')}`);
    }
  }
  return lines;
}

async function axeScan(page: Page, label: string): Promise<void> {
  const violations = await violationsOf(page);
  check(`axe ${label}`, violations.length, 0);
  for (const line of detail(violations)) console.log(line);
}

/**
 * 仕事を LANES 本の並びに流す。
 *
 * 出力は投げた順に並べ直す ― 45 枚が終わった順に流れてくると、
 * どのページが落ちたのか目で追えなくなる。
 */
async function inLanes<T>(jobs: T[], work: (job: T) => Promise<string[]>): Promise<void> {
  const output: string[][] = new Array(jobs.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(LANES, jobs.length) }, async () => {
      for (let i = next; i < jobs.length; i = next) {
        next = i + 1;
        output[i] = await work(jobs[i]);
      }
    }),
  );

  for (const lines of output) for (const line of lines) console.log(line);
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
  /*
   * テーマは読み込む前に決めておく。
   * <head> の中の 1 行が localStorage を読んで data-theme を付けるので、
   * こちらが先に書いておけば、最初の描画からそのテーマで出る。
   * 開いてから塗り替えると、色を見る規則が塗り替わる前の状態を拾うことがある。
   */
  if (theme) {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('git-manabe:theme', t);
      } catch {
        /* 保存できない環境でも、既定のダークで動く */
      }
    }, theme);
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
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
    // 検査そのものが空振りしていないことの確認。
    // out/ が古い・空だと、1 枚も見ないまま「すべて通りました」と出てしまう
    check('ページを見つけている', PAGES.length > 10, true);
    console.log(`ページ ${PAGES.length} 枚を、ダークとライトの両方で見ます。\n`);

    const jobs = (['dark', 'light'] as const).flatMap((theme) =>
      PAGES.map((path) => ({ theme, path })),
    );

    await inLanes(jobs, async ({ theme, path }) => {
      const page = await open(browser, path, theme);
      try {
        const violations = await violationsOf(page);
        return [verdict(`axe ${theme} ${path}`, violations.length, 0), ...detail(violations)];
      } finally {
        await page.close();
      }
    });

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

    // ---- 4. 折りたたみ ----
    // 「ほかのコマンド」は details ではなくボタンにしてある。
    // 開閉が読み上げに乗るのは aria-expanded だけなので、両方向を見る。
    const fold = await open(browser, '/sandbox/');
    // まっさらな状態では打てるのが git init だけなので、畳むものが無い。
    // 1 つコミットして、畳んだ側が出る状態にしてから見る。
    const foldInput = fold.locator('#command-input');
    await foldInput.waitFor({ timeout: 15_000 });
    for (const line of ['git init', 'git commit -m one']) {
      await foldInput.fill(line);
      await foldInput.press('Enter');
      await fold.waitForTimeout(160);
    }

    const toggle = fold.locator('[data-more-toggle]');
    await toggle.waitFor({ timeout: 15_000 });

    check('閉じているとそう伝わる', await toggle.getAttribute('aria-expanded'), 'false');
    check(
      '開く先を指している',
      await toggle.getAttribute('aria-controls'),
      'more-commands',
    );
    check('閉じている間は中身が無い', await fold.locator('#more-commands').count(), 0);

    // キーボードだけで開けること。マウス前提の折りたたみは開かれないまま終わる
    await toggle.focus();
    await fold.keyboard.press('Enter');
    await fold.waitForTimeout(150);
    check('開くとそう伝わる', await toggle.getAttribute('aria-expanded'), 'true');
    check('指した先が現れる', await fold.locator('#more-commands').count(), 1);

    await fold.keyboard.press('Enter');
    await fold.waitForTimeout(150);
    check('閉じ直せる', await toggle.getAttribute('aria-expanded'), 'false');
    await axeScan(fold, '折りたたみ');
    await fold.close();
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
