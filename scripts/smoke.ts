import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { serveStatic } from './serve.ts';

/**
 * 書き出した out/ を実際のブラウザで開き、
 * ターミナルに打ち込んだコマンドがグラフになるところまでを通しで確かめる。
 *
 * ここが通れば「コマンドを打つと DAG が動く」という、このサイトの芯が生きている。
 * 失敗したときだけスクリーンショットを artifacts/ に残す。
 */

const PORT = 4319;
const ROOT = join(process.cwd(), 'out');
const BASE = `http://127.0.0.1:${PORT}/git-manabe`;

const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `  期待: ${JSON.stringify(expected)} / 実際: ${JSON.stringify(actual)}`}`);
  if (!ok) failures.push(label);
}

/**
 * 数が期待どおりになるまで待ってから返す。
 *
 * 退場アニメーションの最中は要素がまだ DOM に残るので、
 * 固定時間で数えると「消えたはずのものが 1 つある」で落ちる。
 */
async function countEventually(
  page: Page,
  selector: string,
  expected: number,
  timeout = 4000,
): Promise<number> {
  const deadline = Date.now() + timeout;
  let actual = await page.locator(selector).count();
  while (actual !== expected && Date.now() < deadline) {
    await page.waitForTimeout(80);
    actual = await page.locator(selector).count();
  }
  return actual;
}

/** ターミナルに 1 行打ち込む。xterm は隠しテキストエリアで入力を受ける。 */
async function type(page: Page, line: string): Promise<void> {
  await page.locator('textarea.xterm-helper-textarea').focus();
  await page.keyboard.type(line, { delay: 4 });
  await page.keyboard.press('Enter');
  // グラフのアニメーションが落ち着くまで待つ
  await page.waitForTimeout(320);
}

/**
 * 環境に Chromium が置いてあるならそれを使う。
 * CI では playwright が自分で取ってくるので、その場合は指定しない。
 */
function findChromium(): string | undefined {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  const preinstalled = '/opt/pw-browsers/chromium';
  return existsSync(preinstalled) ? preinstalled : undefined;
}

async function main(): Promise<void> {
  const server = await serveStatic(ROOT, PORT);
  const executablePath = findChromium();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    // 検査はコンテナの中で root として走ることがある
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  try {
    await page.goto(`${BASE}/sandbox/`, { waitUntil: 'networkidle' });
    await page.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });

    // まだリポジトリが無い状態
    check('最初はグラフが出ていない', await page.locator('[data-testid="commit-graph"]').count(), 0);
    check(
      'リポジトリ側もまだ空だと言う',
      await page.locator('[data-pane="repo"]').getByText('まだリポジトリがありません').count(),
      1,
    );

    await type(page, 'git init');
    await type(page, 'touch a.txt');

    check(
      '作業ディレクトリに a.txt が乗る',
      await page.locator('[data-pane="workingDir"]').getByText('a.txt', { exact: true }).count(),
      1,
    );
    check(
      'それはまだ untracked である',
      await page.locator('[data-pane="workingDir"]').getByText('untracked').count(),
      1,
    );

    await type(page, 'git add .');
    check(
      'add でステージへ移る',
      await page.locator('[data-pane="index"]').getByText('a.txt', { exact: true }).count(),
      1,
    );
    check(
      '作業ディレクトリは空になる',
      await page.locator('[data-pane="workingDir"]').getByText('変更はありません').count(),
      1,
    );

    await type(page, 'git commit -m first');
    check(
      'commit でステージが空になる',
      await page.locator('[data-pane="index"]').getByText('空です').count(),
      1,
    );

    check('コミットが 1 つ描かれる', await countEventually(page, '[data-commit]', 1), 1);
    check('main が現れる', await page.locator('[data-ref="ref:main"]').count(), 1);

    await type(page, 'git branch feature');
    check('枝が 2 本になる', await countEventually(page, '[data-ref^="ref:"]', 2), 2);

    await type(page, 'git switch feature');
    await type(page, 'git commit -m second');

    check('コミットが 2 つになる', await countEventually(page, '[data-commit]', 2), 2);

    // HEAD は feature 側にいる ＝ main とは別のコミットを指している
    const mainTarget = await page.locator('[data-ref="ref:main"]').getAttribute('data-ref-target');
    const featureTarget = await page
      .locator('[data-ref="ref:feature"]')
      .getAttribute('data-ref-target');
    check('main と feature が別のコミットを指す', mainTarget !== featureTarget, true);

    const headLabel = await page.locator('[data-ref="ref:feature"] text').textContent();
    check('HEAD は feature に付いている', headLabel, 'HEAD → feature');

    // detached HEAD に入れることも見る
    await type(page, `git checkout ${mainTarget}`);
    check('detached HEAD のバッジが出る', await countEventually(page, '[data-ref="ref:HEAD"]', 1), 1);

    // 戻せることも見る
    await page.getByRole('button', { name: '← 1 手戻す' }).click();
    check('1 手戻すと detached が解ける', await countEventually(page, '[data-ref="ref:HEAD"]', 0), 0);
    check(
      'HEAD は feature に戻っている',
      await page.locator('[data-ref="ref:feature"] text').textContent(),
      'HEAD → feature',
    );

    // ---- merge ----
    // main に戻り、両側を伸ばして分岐させてから取り込む
    await type(page, 'git switch main');
    await type(page, 'git commit -m 幹の上');
    check('分岐してコミットが 3 つ', await countEventually(page, '[data-commit]', 3), 3);

    await type(page, 'git merge feature');
    check('マージでコミットが 4 つになる', await countEventually(page, '[data-commit]', 4), 4);
    check(
      'マージコミットの凡例が出る',
      await page.getByText('マージコミット（親が 2 つ）').count(),
      1,
    );

    // main と feature が同じコミットを指していないこと（3-way なので main だけ進む）
    const mainAfterMerge = await page.locator('[data-ref="ref:main"]').getAttribute('data-ref-target');
    const featureAfterMerge = await page
      .locator('[data-ref="ref:feature"]')
      .getAttribute('data-ref-target');
    check('3-way では main だけが進む', mainAfterMerge !== featureAfterMerge, true);

    // ---- reset の 3 モード ----
    // --soft: ステージだけに残る
    await type(page, 'git reset --soft HEAD~1');
    check(
      '--soft で中身がステージに残る',
      await page.locator('[data-pane="index"] code').count(),
      1,
    );
    check(
      '--soft では作業ディレクトリに落ちない',
      await page.locator('[data-pane="workingDir"]').getByText('変更はありません').count(),
      1,
    );

    // --mixed: ステージが空になり、作業ディレクトリへ落ちる
    await type(page, 'git reset --mixed HEAD');
    check(
      '--mixed でステージが空になる',
      await page.locator('[data-pane="index"]').getByText('空です').count(),
      1,
    );
    check(
      '--mixed で作業ディレクトリに落ちる',
      await page.locator('[data-pane="workingDir"] code').count(),
      1,
    );

    // --hard: どちらも空になる
    await type(page, 'git reset --hard HEAD');
    check(
      '--hard で作業ディレクトリも空になる',
      await page.locator('[data-pane="workingDir"]').getByText('変更はありません').count(),
      1,
    );

    // ---- rebase ----
    // 分岐を作り直してから、feature を main の上へ置き直す
    await type(page, 'git switch feature');
    await type(page, 'git commit -m 枝をもう一歩');
    const beforeRebase = await page.locator('[data-commit]').count();

    await type(page, 'git rebase main');
    check(
      'rebase でコピーが増え、元も残る',
      (await page.locator('[data-commit]').count()) > beforeRebase,
      true,
    );
    check(
      '指されなくなったコミットの凡例が出る',
      await page.getByText('どの枝からも辿れないコミット', { exact: false }).count(),
      1,
    );

    // ---- revert ----
    const beforeRevert = await page.locator('[data-commit]').count();
    await type(page, 'git revert HEAD');
    check(
      'revert はコミットを 1 つ足す',
      await countEventually(page, '[data-commit]', beforeRevert + 1),
      beforeRevert + 1,
    );

    // ---- stash ----
    await type(page, 'touch wip.txt');
    const graphBeforeStash = await page.locator('[data-commit]').count();
    await type(page, 'git stash');
    check(
      'stash で作業ディレクトリが空になる',
      await page.locator('[data-pane="workingDir"]').getByText('変更はありません').count(),
      1,
    );
    check('stash パネルが出る', await page.locator('[data-pane="stash"]').count(), 1);
    check(
      'stash でグラフは変わらない',
      await page.locator('[data-commit]').count(),
      graphBeforeStash,
    );

    await type(page, 'git stash pop');
    check(
      'pop で作業ディレクトリに戻る',
      await page.locator('[data-pane="workingDir"] code').count(),
      1,
    );
    check('stash パネルが消える', await countEventually(page, '[data-pane="stash"]', 0), 0);

    // ---- reflog からの復元 ----
    // わざと reset --hard で切り離してから、拾い直せることを見る
    const tipBeforeLoss = await page
      .locator('[data-ref="ref:feature"]')
      .getAttribute('data-ref-target');
    const commitsBeforeLoss = await page.locator('[data-commit]').count();

    await type(page, 'git reset --hard HEAD~1');
    check(
      '切り離してもコミットは消えない',
      await page.locator('[data-commit]').count(),
      commitsBeforeLoss,
    );
    check(
      '辿れないコミットとして数えられる',
      await page.getByText('どの枝からも辿れないコミット', { exact: false }).count(),
      1,
    );

    await type(page, `git switch -c 救出 ${tipBeforeLoss}`);
    check(
      '救出という枝が生える',
      await countEventually(page, '[data-ref="ref:救出"]', 1),
      1,
    );
    check(
      '拾った先は、失くしたコミットそのもの',
      await page.locator('[data-ref="ref:救出"]').getAttribute('data-ref-target'),
      tipBeforeLoss,
    );

    check('コンソールにエラーが出ていない', consoleErrors, []);

    // アニメーションを減らす設定でも、中身は同じように出ること
    const still = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    });
    await still.goto(`${BASE}/sandbox/`, { waitUntil: 'networkidle' });
    await still.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });
    await type(still, 'git init');
    await type(still, 'git commit -m first');
    await type(still, 'git commit -m second');
    check(
      'アニメーションを切ってもグラフは描かれる',
      await countEventually(still, '[data-commit]', 2),
      2,
    );
    check(
      'アニメーションを切っても main は出る',
      await still.locator('[data-ref="ref:main"]').count(),
      1,
    );
    await still.close();

    if (failures.length > 0) {
      mkdirSync(join(process.cwd(), 'artifacts'), { recursive: true });
      await page.screenshot({ path: join(process.cwd(), 'artifacts', 'sandbox.png'), fullPage: true });
      console.error(`\n${failures.length} 件失敗しました。artifacts/sandbox.png を見てください。`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) process.exit(1);
  console.log('\nすべて通りました。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
