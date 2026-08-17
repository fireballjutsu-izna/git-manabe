import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { serveStatic } from './serve.ts';

/**
 * 狭い画面での通し確認。
 *
 * 机の上の画面では、まず起きない壊れ方がある:
 *   - 横にはみ出して、本文が画面の外へ出る
 *   - ボタンが指で押せない大きさになっている
 *   - 補助の文字が小さすぎて読めない
 *   - ターミナルが画面を埋めてしまい、グラフが見えない
 *
 * smoke は 5 ページを 360px で見ていただけだった。
 * 記事が増えるたびに同じ抜け方をするので、a11y と同じく out/ から全部拾う。
 *
 * 3 本立て:
 *   1. 通し検査 … 全ページ × 2 幅。はみ出し・タップ領域・文字の大きさ
 *   2. 操作     … 入力欄とボタンだけで、レベルを 1 つ最後まで解けるか
 *   3. 見え方   … ターミナルとグラフが、どちらも画面に入るか
 */

const PORT = 4351;
const ROOT = join(process.cwd(), 'out');
const BASE = `http://127.0.0.1:${PORT}/git-manabe`;

/** 同時に開くページ数。 */
const LANES = 4;

/**
 * 見る画面幅。
 *   320 … いまも売られているいちばん狭い部類（iPhone SE 第 1 世代など）
 *   390 … いまどきの標準的な 1 台
 * 640px 以上は smoke と a11y が見ているので、ここでは触らない。
 */
const SIZES = [
  { name: '320px', width: 320, height: 568 },
  { name: '390px', width: 390, height: 844 },
];

/** 指で押せる大きさ。iOS も Android も、目安はこのあたりで揃っている。 */
const TAP = 44;

/** 狭い画面での文字の下限。これを下回ると、拡大しないと読めない。 */
const MIN_FONT = 12;

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

function verdict(label: string, actual: unknown, expected: unknown): string {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(label);
  return `${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `  期待: ${JSON.stringify(expected)} / 実際: ${JSON.stringify(actual)}`}`;
}

function check(label: string, actual: unknown, expected: unknown): void {
  console.log(verdict(label, actual, expected));
}

function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  return existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}

async function open(
  browser: Browser,
  path: string,
  size: { width: number; height: number },
): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
    // 指で触る端末として開く。hover が効かなくなるので、hover 頼みの作りがあれば出る
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  return page;
}

interface Report {
  /** 横スクロールできる入れ物の外へ出てしまった要素。 */
  overflowing: string[];
  /** 指で押すには小さすぎるもの。 */
  small: string[];
  /** 読むには小さすぎる文字。 */
  tiny: string[];
  /** ページ全体が横に伸びているか。 */
  wide: boolean;
}

/**
 * ページ 1 枚を測る。
 *
 * 判定はすべてブラウザの中でやる ― レイアウトの結果は、
 * ソースを読んでも分からない（Tailwind のクラスから幅は決まらない）。
 */
async function measure(
  page: Page,
  tap: number,
  minFont: number,
  width: number,
): Promise<Report> {
  return page.evaluate(
    ({ tap: tapSize, minFont: fontFloor, width: screen }) => {
      /*
       * 画面の幅は window.innerWidth ではなく、外から渡した値で見る。
       *
       * 端末として開いていると、収まらない中身があったときに
       * **レイアウトのほうが広がる**（実機ではページが縮小されて表示される）。
       * innerWidth もその広がった値になるので、両方を比べると必ず一致してしまい、
       * はみ出しを 1 件も拾えない。
       */
      const inner = screen;

      /** 横に流せる入れ物の中なら、はみ出していても構わない。 */
      const scrollableAncestor = (el: Element): Element | null => {
        let p: Element | null = el.parentElement;
        while (p && p !== document.body) {
          const s = getComputedStyle(p);
          const flows = s.overflowX === 'auto' || s.overflowX === 'scroll';
          if (flows && p.scrollWidth > p.clientWidth + 1) return p;
          p = p.parentElement;
        }
        return null;
      };

      const name = (el: Element): string => {
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
        const id = (el as HTMLElement).id;
        return `${el.tagName.toLowerCase()}${id ? `#${id}` : ''}${text ? `「${text}」` : ''}`;
      };

      /** 画面に出ていないもの（読み上げ専用など）は測らない。 */
      const hidden = (el: Element, r: DOMRect): boolean => {
        if (r.width <= 2 || r.height <= 2) return true;
        const s = getComputedStyle(el);
        return s.visibility === 'hidden' || s.opacity === '0' || s.display === 'none';
      };

      const overflowing: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('svg')) continue; // グラフは中で横に流す
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right <= inner + 1) continue;
        if (scrollableAncestor(el)) continue;
        overflowing.push(`${name(el)} 右端 ${Math.round(r.right)}px`);
      }

      const small: string[] = [];
      const targets = document.querySelectorAll(
        'button, [role="button"], input, select, textarea, a',
      );
      for (const el of targets) {
        const r = el.getBoundingClientRect();
        if (hidden(el, r)) continue;
        const s = getComputedStyle(el);
        // xterm の隠し入力は、カーソル位置に貼り付いている実体のない要素
        if (el.classList.contains('xterm-helper-textarea')) continue;
        /*
         * 本文の中のリンクは、行の高さより大きくできない（文章が壊れる）。
         * WCAG も、文の流れの中のリンクは対象外にしている。
         * 見分けは padding で付く ― ボタンとして置いたものには必ず padding がある。
         */
        if (el.tagName === 'A') {
          const pad =
            parseFloat(s.paddingTop) +
            parseFloat(s.paddingBottom) +
            parseFloat(s.paddingLeft) +
            parseFloat(s.paddingRight);
          if (pad === 0) continue;
        }
        if (Math.min(r.width, r.height) + 0.5 < tapSize) {
          small.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}px`);
        }
      }

      const tiny: string[] = [];
      const seen = new Set<string>();
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('svg')) continue;
        // 自分が直に持っている文字だけを見る。親まで数えると同じ文で何度も出る
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => (n.textContent ?? '').trim())
          .join('');
        if (!own) continue;
        const r = el.getBoundingClientRect();
        if (hidden(el, r)) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size + 0.01 < fontFloor) {
          const line = `${name(el)} ${size}px`;
          if (!seen.has(line)) {
            seen.add(line);
            tiny.push(line);
          }
        }
      }

      return {
        overflowing: overflowing.slice(0, 5),
        small: small.slice(0, 5),
        tiny: tiny.slice(0, 5),
        wide:
          document.documentElement.scrollWidth > inner + 1 || window.innerWidth > inner + 1,
      };
    },
    { tap, minFont, width },
  );
}

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

async function main(): Promise<void> {
  const server = await serveStatic(ROOT, PORT);
  const executablePath = findChromium();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox'],
  });

  try {
    // ---- 1. 通し検査 ----
    check('ページを見つけている', PAGES.length > 10, true);
    console.log(`ページ ${PAGES.length} 枚を、${SIZES.map((s) => s.name).join(' と ')} で見ます。\n`);

    const jobs = SIZES.flatMap((size) => PAGES.map((path) => ({ size, path })));

    await inLanes(jobs, async ({ size, path }) => {
      const page = await open(browser, path, size);
      try {
        const r = await measure(page, TAP, MIN_FONT, size.width);
        const lines = [
          verdict(
            `${size.name} ${path}`,
            {
              横に伸びていない: !r.wide,
              画面の外に出ていない: r.overflowing.length === 0,
              指で押せる: r.small.length === 0,
              読める大きさ: r.tiny.length === 0,
            },
            {
              横に伸びていない: true,
              画面の外に出ていない: true,
              指で押せる: true,
              読める大きさ: true,
            },
          ),
        ];
        for (const o of r.overflowing) lines.push(`        はみ出し: ${o}`);
        for (const s of r.small) lines.push(`        小さすぎる: ${s}`);
        for (const t of r.tiny) lines.push(`        文字が小さい: ${t}`);
        return lines;
      } finally {
        await page.close();
      }
    });

    // ---- 2. 操作 ----
    /*
     * 指だけでレベルを 1 つ解けること。
     * xterm への直接入力はスマートフォンで空白が落ちるので、
     * 素の入力欄とコマンドボタンだけで最後まで行けなければならない。
     */
    console.log('');
    const phone = await open(browser, '/levels/areas/', SIZES[1]);
    await phone.locator('#command-input').waitFor({ timeout: 15_000 });

    const field = phone.locator('#command-input');
    for (const line of ['touch hello.txt', 'git add .']) {
      await field.fill(line);
      await field.press('Enter');
      await phone.waitForTimeout(250);
    }
    check(
      '入力欄だけでコマンドが通る',
      (await phone.locator('[data-pane="index"]').innerText()).includes('hello.txt'),
      true,
    );

    // 仕上げはボタンで。指で押す人はこちらしか使わない
    const commit = phone.locator('[data-buttons="now"] button', { hasText: 'git commit' }).first();
    await commit.tap();
    await phone.waitForTimeout(700);
    check('ボタンをタップして解ける', await phone.locator('[data-testid="cleared"]').count(), 1);
    await phone.close();

    // ---- 3. 見え方 ----
    /*
     * 縦に積んだとき、ターミナルだけで画面が終わっていないこと。
     * グラフが 1 画面目に出てこないと、「打つと木が育つ」が伝わらない。
     */
    const view = await open(browser, '/sandbox/', SIZES[1]);
    await view.locator('#command-input').waitFor({ timeout: 15_000 });
    for (const line of ['git init', 'git commit -m はじめ']) {
      await view.locator('#command-input').fill(line);
      await view.locator('#command-input').press('Enter');
      await view.waitForTimeout(250);
    }

    const layout = await view.evaluate(() => {
      const graph = document.querySelector('[data-testid="commit-graph"]');
      const term = document.querySelector('.xterm-screen');
      return {
        graphTop: graph ? Math.round(graph.getBoundingClientRect().top) : -1,
        termHeight: term ? Math.round(term.getBoundingClientRect().height) : -1,
        viewport: window.innerHeight,
      };
    });
    check('グラフが描かれている', layout.graphTop >= 0, true);
    check(
      'グラフが 2 画面ぶんも下へ行っていない',
      layout.graphTop < layout.viewport * 2,
      true,
    );
    check(
      'ターミナルが画面の 6 割を超えて占めていない',
      layout.termHeight < layout.viewport * 0.6,
      true,
    );

    // 固定ヘッダーが本文の先頭を隠していないこと
    const covered = await view.evaluate(() => {
      const header = document.querySelector('header')!.getBoundingClientRect();
      const h1 = document.querySelector('main h1')?.getBoundingClientRect();
      return h1 ? h1.top < header.bottom : false;
    });
    check('固定ヘッダーが見出しを隠していない', covered, false);
    await view.close();
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
