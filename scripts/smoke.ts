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

    // ---- リモート ----
    await type(page, 'git switch main');
    await type(page, 'git remote add origin https://example.com/repo.git');
    check('リモートパネルが出る', await page.locator('[data-pane="remote"]').count(), 1);

    await type(page, 'git push origin main');
    check(
      'push で origin/main が現れる',
      await countEventually(page, '[data-ref="remote:origin/main"]', 1),
      1,
    );

    // 同僚が進めても、こちらのグラフは変わらない
    const beforeTeammate = await page.locator('[data-commit]').count();
    await type(page, 'teammate 2');
    check(
      'teammate ではグラフが変わらない',
      await page.locator('[data-commit]').count(),
      beforeTeammate,
    );
    check(
      'まだ持っていないと知らせる',
      await page.locator('[data-pane="remote"]').getByText('まだ持っていないコミット').count(),
      1,
    );

    // fetch は取ってくるだけ。手元の枝は動かない
    const mainBeforeFetch = await page.locator('[data-ref="ref:main"]').getAttribute('data-ref-target');
    await type(page, 'git fetch origin');
    check(
      'fetch でコミットが増える',
      await countEventually(page, '[data-commit]', beforeTeammate + 2),
      beforeTeammate + 2,
    );
    check(
      'fetch では main が動かない',
      await page.locator('[data-ref="ref:main"]').getAttribute('data-ref-target'),
      mainBeforeFetch,
    );

    // pull で初めて main が動く
    await type(page, 'git pull origin main');
    const mainAfterPull = await page.locator('[data-ref="ref:main"]').getAttribute('data-ref-target');
    check('pull で main が動く', mainAfterPull !== mainBeforeFetch, true);
    check(
      'pull のあと main と origin/main が揃う',
      mainAfterPull,
      await page.locator('[data-ref="remote:origin/main"]').getAttribute('data-ref-target'),
    );

    // ---- レベル ----
    // 一覧 → 1 つ解く → クリア記録が残り、一覧に反映される、まで通す
    await page.goto(`${BASE}/levels/`, { waitUntil: 'networkidle' });
    check('レベルが 15 個並ぶ', await page.locator('[data-level]').count(), 15);
    check(
      '最初はどれもクリアしていない',
      await page.locator('[data-level][data-cleared]').count(),
      0,
    );

    await page.goto(`${BASE}/levels/areas/`, { waitUntil: 'networkidle' });
    await page.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });
    check('やることが出ている', await page.locator('[data-testid="task"]').count(), 1);
    check('まだクリアしていない', await page.locator('[data-testid="cleared"]').count(), 0);

    await type(page, 'touch hello.txt');
    await type(page, 'git add .');
    await type(page, 'git commit -m はじめ');
    check(
      '解くとクリア表示が出る',
      await countEventually(page, '[data-testid="cleared"]', 1),
      1,
    );

    // 記録が localStorage に残り、一覧に反映されること
    await page.goto(`${BASE}/levels/`, { waitUntil: 'networkidle' });
    check(
      'クリアが一覧に反映される',
      await countEventually(page, '[data-level][data-cleared]', 1),
      1,
    );
    check(
      '連続日数が 1 になる',
      await page.locator('[data-testid="progress"]').getByText('1', { exact: true }).count(),
      2,
    );

    // ヒントは押すまで出ない
    await page.goto(`${BASE}/levels/rebase/`, { waitUntil: 'networkidle' });
    await page.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });
    check(
      'ヒントは最初は隠れている',
      await page.getByText('git rebase main です。').count(),
      0,
    );
    await page.getByRole('button', { name: /ヒントを見る/ }).click();
    check(
      '押すと 1 つ目だけ出る',
      await countEventually(page, 'text=git rebase main です。', 1),
      1,
    );

    // ---- コンフリクト ----
    // 止まる → やめて元通り → もう一度やって決着をつける、まで通す
    await page.goto(`${BASE}/levels/conflict/`, { waitUntil: 'networkidle' });
    await page.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });
    const beforeConflict = await page.locator('[data-commit]').count();

    await type(page, 'git merge feature');
    check('ぶつかると専用のパネルが出る', await countEventually(page, '[data-pane="pausing"]', 1), 1);
    check('止まってもコミットは増えない', await page.locator('[data-commit]').count(), beforeConflict);
    check(
      'ぶつかったファイルが作業ディレクトリに出る',
      await page.locator('[data-pane="workingDir"]').getByText('両方が変更').count(),
      1,
    );
    check('止まっている間はクリアにならない', await page.locator('[data-testid="cleared"]').count(), 0);

    /*
     * 目印が本当に書き込まれていること。ここが行単位になった証拠になる。
     *
     * ターミナルの中だけを数える ― 読み上げ用の領域（role=status）にも
     * 同じ文が入るので、ページ全体で数えると必ず 2 になる。
     */
    await type(page, 'git diff');
    check(
      'ファイルに目印が書き込まれている',
      await countEventually(page, '.xterm-screen >> text=<<<<<<< HEAD', 1),
      1,
    );

    // 目印が残ったままの add は断る（本物は通してしまうところ）
    await type(page, 'git add app.ts');
    check(
      '目印が残ったままの add は断られる',
      await countEventually(page, '.xterm-screen >> text=まだコンフリクトの目印が残っています', 1),
      1,
    );

    await type(page, 'git merge --abort');
    check('--abort でパネルが消える', await countEventually(page, '[data-pane="pausing"]', 0), 0);
    check(
      '--abort で作業ディレクトリも元通り',
      await page.locator('[data-pane="workingDir"]').getByText('変更はありません').count(),
      1,
    );

    await type(page, 'git merge feature');
    await type(page, 'git checkout --ours app.ts');
    await type(page, 'git add app.ts');
    check(
      'add すると commit できると教えてくれる',
      await page.locator('[data-pane="pausing"]').getByText('git commit').count(),
      1,
    );

    await type(page, 'git commit');
    check('commit でパネルが消える', await countEventually(page, '[data-pane="pausing"]', 0), 0);
    check(
      'マージコミットが 1 つ増える',
      await countEventually(page, '[data-commit]', beforeConflict + 1),
      beforeConflict + 1,
    );
    check('解くとクリア表示が出る', await countEventually(page, '[data-testid="cleared"]', 1), 1);

    // ---- 狭い画面 ----
    // グリッドの子は min-width:auto が既定で、xterm の最小幅にひきずられて
    // 本文ごと横にはみ出す。目で見て気づきにくいので、数で押さえておく。
    const narrow = await browser.newPage({ viewport: { width: 360, height: 780 } });
    for (const path of ['/', '/start/', '/levels/', '/sandbox/', '/levels/conflict/']) {
      await narrow.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await narrow.waitForTimeout(500);
      const size = await narrow.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
        nav: document.querySelector('header nav')!.getBoundingClientRect().height,
        bar: document.querySelector('header > div')!.getBoundingClientRect().height,
      }));
      check(`360px で横にはみ出さない ${path}`, size.scroll <= size.inner + 1, true);
      check(`360px でヘッダーが 1 行に収まる ${path}`, size.nav <= size.bar, true);
    }
    await narrow.close();

    // 404 は日本語で、行き先が付いていること
    const missing = await browser.newPage({ viewport: { width: 1024, height: 700 } });
    const missingRes = await missing.goto(`${BASE}/nope/`, { waitUntil: 'domcontentloaded' });
    check('無い住所は 404 を返す', missingRes?.status(), 404);
    check(
      '404 は日本語で出る',
      await missing.getByText('そのページはありません').count(),
      1,
    );
    check('404 から戻る道がある', await missing.locator('main a').count(), 3);
    await missing.close();

    // ---- 入力欄 ----
    // xterm への直接入力はスマートフォンでスペースが落ちるので、素の入力欄も置いてある
    await page.goto(`${BASE}/sandbox/`, { waitUntil: 'networkidle' });
    await page.locator('#command-input').waitFor({ timeout: 15_000 });
    const field = page.locator('#command-input');
    await field.fill('git init');
    await page.getByRole('button', { name: '実行' }).click();
    await page.waitForTimeout(400);
    check(
      '入力欄から実行できる',
      (await page.locator('[data-pane="repo"]').innerText()).includes('まだリポジトリがありません'),
      false,
    );
    await field.fill('git commit -m 空白を含む指定');
    await field.press('Enter');
    check('空白を含む行も通る', await countEventually(page, '[data-commit]', 1), 1);
    await field.press('ArrowUp');
    check('↑ で履歴を呼び戻せる', await field.inputValue(), 'git commit -m 空白を含む指定');

    // 指で操作する端末では、ターミナルを叩いても打てない
    // （仮想キーボードがスペースを変換の確定に使うため）。入力欄へ送る
    const touch = await browser.newPage({
      viewport: { width: 393, height: 851 },
      hasTouch: true,
      isMobile: true,
    });
    await touch.goto(`${BASE}/sandbox/`, { waitUntil: 'networkidle' });
    await touch.locator('#command-input').waitFor({ timeout: 15_000 });
    const screen = await touch.locator('.xterm-screen').boundingBox();
    await touch.touchscreen.tap(screen!.x + 30, screen!.y + 30);
    await touch.waitForTimeout(300);
    check(
      'タッチ端末はターミナルを叩くと入力欄へ移る',
      await touch.evaluate(() => document.activeElement?.id),
      'command-input',
    );
    await touch.close();

    // 合成クリック（element.click()）ではフォーカスが動かないので、実際に押す
    await page.locator('.xterm-screen').click();
    await page.waitForTimeout(200);
    check(
      'マウスの端末では、これまでどおりターミナルに入る',
      await page.evaluate(() => document.activeElement?.className),
      'xterm-helper-textarea',
    );

    // ---- コマンドボタンの名前 ----
    // 課題が名前を指定しているレベルでは、その名前が出ること
    await page.goto(`${BASE}/levels/areas/`, { waitUntil: 'networkidle' });
    await page.locator('#command-input').waitFor({ timeout: 15_000 });
    check(
      '課題の言うファイル名がボタンに出る',
      await page.getByRole('button', { name: /touch hello\.txt/ }).count(),
      1,
    );
    await page.goto(`${BASE}/levels/branch/`, { waitUntil: 'networkidle' });
    await page.locator('#command-input').waitFor({ timeout: 15_000 });
    check(
      '課題の言う枝の名前がボタンに出る',
      await page.getByRole('button', { name: /git branch feature$|git branch feature[^-]/ }).count(),
      1,
    );

    // ---- コマンドボタンの絞り込み ----
    // 全部並べると 12 個になって肝心のものが埋もれるので、2 段に分けてある。
    // とくに reset --hard が最初から見えているのは危うい ―
    // シナリオの途中で押すと、そこまでの手順が消える。
    //
    // 枝が何本も出ている状態でも表が溢れないことを見たいので、
    // いちばん枝の多い showcase で数える。
    await page.goto(`${BASE}/scenarios/showcase/`, { waitUntil: 'networkidle' });
    await page.locator('#command-input').waitFor({ timeout: 15_000 });
    check(
      '表に出るボタンは 6 個まで',
      (await page.locator('[data-buttons="now"] button:not([data-more-toggle])').count()) <= 6,
      true,
    );

    // reset --hard は「HEAD に親がある」ときだけ出る。
    // 出る状態まで進めたうえで、それでも畳まれていることを見る。
    await page.goto(`${BASE}/sandbox/`, { waitUntil: 'networkidle' });
    const field3 = page.locator('#command-input');
    await field3.waitFor({ timeout: 15_000 });
    for (const line of ['git init', 'git commit -m one', 'git commit -m two']) {
      await field3.fill(line);
      await field3.press('Enter');
      await page.waitForTimeout(160);
    }

    check(
      'reset --hard は最初から見えてはいない',
      await page.getByRole('button', { name: /reset --hard/ }).count(),
      0,
    );
    check('畳んだ側は最初は出ていない', await page.locator('[data-buttons="more"]').count(), 0);

    const moreToggle = page.locator('[data-more-toggle]');
    check('畳んだ側は閉じていると伝わる', await moreToggle.getAttribute('aria-expanded'), 'false');
    await moreToggle.click();
    await page.waitForTimeout(150);
    check('開くと開いたと伝わる', await moreToggle.getAttribute('aria-expanded'), 'true');
    check(
      '開けば reset --hard も押せる',
      await page.getByRole('button', { name: /reset --hard/ }).count(),
      1,
    );
    check(
      '畳んだ側は aria-controls の指す先に出る',
      await page.locator('#more-commands[data-buttons="more"]').count(),
      1,
    );

    // ---- 対話的 rebase ----
    // -i は「打っても何も起きない」が要点。パネルで組み立ててから実行する
    await page.goto(`${BASE}/levels/interactive/`, { waitUntil: 'networkidle' });
    const todoInput = page.locator('#command-input');
    await todoInput.waitFor({ timeout: 15_000 });
    const beforeTodo = await page.locator('[data-commit]').count();
    const sendTodo = async (line: string) => {
      await todoInput.fill(line);
      await todoInput.press('Enter');
      await page.waitForTimeout(260);
    };

    await sendTodo('git rebase -i main');
    check('計画のパネルが出る', await countEventually(page, '[data-pane="todo"]', 1), 1);
    check('todo が 3 行並ぶ', await page.locator('[data-todo]').count(), 3);
    check('打っただけではコミットが増えない', await page.locator('[data-commit]').count(), beforeTodo);
    // パネルの中だけを数える。同じ文はターミナルにも読み上げ用の領域にも出る
    check(
      'まだ変わっていないと書いてある',
      await page.locator('[data-pane="todo"]').getByText('まだ履歴は何も変わっていません').count(),
      1,
    );

    // ボタンは todo コマンドを打つ ― ターミナルにも残る
    await page.locator('[data-todo]').nth(1).getByRole('button', { name: 'squash' }).click();
    await page.waitForTimeout(200);
    check(
      'squash がパネルに反映される',
      await page.locator('[data-todo][data-todo-action="squash"]').count(),
      1,
    );
    check(
      'ボタンが打ったコマンドがターミナルに残る',
      await countEventually(page, '.xterm-screen >> text=todo squash 2', 1),
      1,
    );

    await page.locator('[data-todo]').nth(2).getByRole('button', { name: 'drop' }).click();
    await page.waitForTimeout(200);
    check(
      'drop がパネルに反映される',
      await page.locator('[data-todo][data-todo-action="drop"]').count(),
      1,
    );

    await page.locator('[data-todo-run]').click();
    check('実行するとパネルが消える', await countEventually(page, '[data-pane="todo"]', 0), 0);
    check(
      'まとめた 1 件がグラフに出る',
      // <title>（ツールチップ）にも同じ文が入るので、描かれている text 要素だけ数える
      await countEventually(
        page,
        '[data-testid="commit-graph"] text:text-is("ラッピングを直した + typo")',
        1,
      ),
      1,
    );
    check('レベルをクリアできる', await countEventually(page, '[data-testid="cleared"]', 1), 1);

    // ---- 記事 ----
    // 記事とレベルは同じ id で結ばれている。行き来できることを通しで見る
    await page.goto(`${BASE}/docs/`, { waitUntil: 'networkidle' });
    check('記事が 15 本並ぶ', await page.locator('[data-doc]').count(), 15);

    await page.goto(`${BASE}/docs/conflict/`, { waitUntil: 'networkidle' });
    check('記事の見出しが出る', await page.locator('h1').count(), 1);
    check(
      '記事から対応するレベルへ行ける',
      await page.locator('a[href$="/levels/conflict/"]').count(),
      1,
    );
    await page.locator('a[href$="/levels/conflict/"]').first().click();
    await page.waitForURL('**/levels/conflict/**', { timeout: 10_000 });
    await page.locator('textarea.xterm-helper-textarea').waitFor({ timeout: 15_000 });
    check(
      'レベルから記事へ戻れる',
      await page.locator('a[href$="/docs/conflict/"]').count(),
      1,
    );

    // ---- シナリオ ----
    await page.goto(`${BASE}/scenarios/`, { waitUntil: 'networkidle' });
    check('シナリオが 7 本並ぶ', await page.locator('[data-scenario]').count(), 7);
    check(
      '最初はどれも片付いていない',
      await page.locator('[data-scenario][data-done]').count(),
      0,
    );

    // 1 本を通しで解く。依頼が順に届き、最後に星が付くところまで
    await page.goto(`${BASE}/scenarios/hotfix/`, { waitUntil: 'networkidle' });
    await page.locator('#command-input').waitFor({ timeout: 15_000 });
    check('最初は依頼が 1 件だけ届いている', await page.locator('[data-step]').count(), 1);

    const field2 = page.locator('#command-input');
    const send = async (line: string) => {
      await field2.fill(line);
      await field2.press('Enter');
      await page.waitForTimeout(280);
    };

    await send('git stash');
    check('1 つ満たすと次の依頼が届く', await countEventually(page, '[data-step]', 2), 2);
    check('済んだ依頼は残る', await page.locator('[data-step][data-done]').count(), 1);

    for (const line of [
      'git switch main',
      'git switch -c hotfix',
      'edit bouquet.txt',
      'git add bouquet.txt',
      'git commit -m 差し替えた',
      'git switch main',
      'git merge hotfix',
      'git switch new-design',
      'git stash pop',
    ]) {
      await send(line);
    }

    check('最後まで解くと完了が出る', await countEventually(page, '[data-testid="finished"]', 1), 1);
    check(
      '最短で解いたので星が 3 つ',
      await page.locator('[data-testid="finished"]').getByLabel('星 3 つ').count(),
      1,
    );

    // 記録が残り、一覧に反映されること
    await page.goto(`${BASE}/scenarios/`, { waitUntil: 'networkidle' });
    check(
      '片付けた仕事が一覧に出る',
      await countEventually(page, '[data-scenario][data-done]', 1),
      1,
    );

    // コンフリクトを含む回でも、途中の画面が壊れないこと
    await page.goto(`${BASE}/scenarios/clash/`, { waitUntil: 'networkidle' });
    await page.locator('#command-input').waitFor({ timeout: 15_000 });
    await send('git merge spring');
    check('止まると専用のパネルが出る', await countEventually(page, '[data-pane="pausing"]', 1), 1);
    check('その先の依頼が届く', await countEventually(page, '[data-step]', 2), 2);
    await send('git checkout --theirs vase.txt');
    await send('git add vase.txt');
    await send('git commit');
    check(
      'コンフリクトの回も最後まで解ける',
      await countEventually(page, '[data-testid="finished"]', 1),
      1,
    );

    // ---- .gitignore と、出してしまった秘密 ----
    // 「書いたのに効かない」と「外しても履歴には残る」の 2 つを、画面で確かめる
    await page.goto(`${BASE}/scenarios/secret/`, { waitUntil: 'networkidle' });
    const secretInput = page.locator('#command-input');
    await secretInput.waitFor({ timeout: 15_000 });
    const sendSecret = async (line: string) => {
      await secretInput.fill(line);
      await secretInput.press('Enter');
      await page.waitForTimeout(260);
    };

    await sendSecret('git rm --cached .env');
    check(
      '外すと「履歴には残る」と言う',
      await countEventually(page, '.xterm-screen >> text=過去のコミットには', 1),
      1,
    );

    await sendSecret('touch .gitignore');
    await sendSecret('append .gitignore .env');
    check(
      '無視されたファイルは作業ディレクトリで薄くなる',
      await page.locator('[data-pane="workingDir"]').getByText('ignored').count(),
      1,
    );

    await sendSecret('git add .');
    check(
      'git add . では入らない',
      await countEventually(page, '.xterm-screen >> text=.gitignore で無視したので', 1),
      1,
    );
    check(
      'ステージに載っているのは「外す」ほう',
      await page.locator('[data-pane="index"]').getByText('追跡をやめる').count(),
      1,
    );

    await sendSecret('git commit -m ".env を追跡から外した"');
    await sendSecret('git push origin main');
    check(
      '秘密の回も最後まで解ける',
      await countEventually(page, '[data-testid="finished"]', 1),
      1,
    );

    // ---- グラフの向きと、場面ごとの見た目 ----
    // 縦になったので、狭い画面でもグラフのぶんだけ横へ広がることはない
    const narrowGraph = await browser.newPage({ viewport: { width: 360, height: 780 } });
    await narrowGraph.goto(`${BASE}/scenarios/hotfix/`, { waitUntil: 'networkidle' });
    await narrowGraph.locator('#command-input').waitFor({ timeout: 15_000 });
    await narrowGraph.waitForTimeout(500);
    check(
      '360px でもグラフが横へはみ出さない',
      await narrowGraph.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      true,
    );
    await narrowGraph.close();

    // シナリオは花、レベルとサンドボックスは実物どおり
    check(
      'シナリオのグラフは花で描かれる',
      (await page.goto(`${BASE}/scenarios/clash/`, { waitUntil: 'networkidle' })) !== null &&
        (await countEventually(page, '[data-bloom]', 4)) > 0,
      true,
    );
    await page.goto(`${BASE}/levels/three-way/`, { waitUntil: 'networkidle' });
    await page.locator('#command-input').waitFor({ timeout: 15_000 });
    check('レベルのグラフは花にならない', await page.locator('[data-bloom]').count(), 0);
    check('レベルでもグラフは出ている', await page.locator('[data-commit]').count(), 3);

    // 新しいコミットが最上段に来る（縦にした狙いそのもの）
    await page.locator('#command-input').fill('git commit -m 目印');
    await page.locator('#command-input').press('Enter');
    await page.waitForTimeout(500);
    check(
      '打ったばかりのコミットが最上段に出る',
      await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('[data-commit]'));
        const tops = nodes.map((n) => n.getBoundingClientRect().top);
        const newest = nodes.find((n) => (n.textContent ?? '').includes('目印'));
        return newest !== undefined && newest.getBoundingClientRect().top === Math.min(...tops);
      }),
      true,
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
