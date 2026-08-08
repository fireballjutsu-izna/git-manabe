import { headCommitId } from '@/lib/git-engine';
import type { Level } from './types';

/**
 * カリキュラム順のレベル。
 *
 * 1 レベル 1 概念。前のレベルで出たものしか使わせない。
 * setup で「その概念が要る状況」まで作っておき、
 * ユーザーには**その概念そのもの**だけを打たせる。
 */
export const LEVELS: Level[] = [
  {
    id: 'areas',
    title: '3 つの領域',
    intro:
      'Git が値を持つ場所は、作業ディレクトリ・ステージ・リポジトリの 3 つです。add と commit は、そのあいだを運ぶ係にすぎません。',
    task: 'hello.txt を作り、ステージへ移し、コミットしてください。',
    setup: ['git init'],
    goal: ['git init', 'touch hello.txt', 'git add .', 'git commit -m はじめ'],
    check: (s) => s.tracked.includes('hello.txt') && s.index.length === 0,
    suggest: { file: 'hello.txt' },
    hints: [
      'touch hello.txt でファイルを作れます（これは Git のコマンドではありません）。',
      'git add hello.txt でステージへ移ります。',
      'git commit -m "はじめ" で確定します。',
    ],
  },
  {
    id: 'ignore',
    title: '.gitignore ― 出してしまったものを引っ込める',
    intro:
      '.gitignore は「まだ追跡していないファイル」にしか効きません。すでにコミットしてしまったものは、書いただけでは止まらず、追跡から外すところまでやって初めて無視されます。',
    task:
      'すでにコミットしてしまった .env を追跡から外し、これから無視されるようにして、そこまでをコミットしてください。ファイルは手元に残したままです。',
    setup: [
      'git init',
      'touch app.txt',
      'touch .env  API_KEY=ひみつ',
      'git add .',
      'git commit -m 開店',
    ],
    check: (s) => {
      const head = headCommitId(s);
      if (!head) return false;
      const tree = s.commits[head].tree;
      // 最新のコミットから .env が消えていて、.gitignore が入っていること
      if (tree['.env'] !== undefined) return false;
      if (tree['.gitignore'] === undefined) return false;
      if (!tree['.gitignore'].some((line) => line.trim() === '.env')) return false;
      // 手元のファイルは消さない。消したら「引っ込める」ではなく「捨てる」
      return s.work['.env'] !== undefined && s.index.length === 0;
    },
    suggest: { file: '.gitignore' },
    hints: [
      '.gitignore に書くだけでは止まりません。すでに追跡しているファイルには効かないからです。',
      'touch .gitignore で作り、append .gitignore .env で 1 行足せます。',
      'git rm --cached .env で追跡から外します。--cached を付けると、手元のファイルは残ります。',
      'あとは git add .gitignore と git commit です。',
      '終わったら git diff HEAD~1 HEAD を見てください。1 つ前のコミットには、まだ .env が入っています。',
    ],
  },
  {
    id: 'branch',
    title: '枝と HEAD',
    intro:
      'ブランチは「あるコミットに付けた名前」でしかありません。HEAD は「いまどこにいるか」を指す別のポインタです。',
    task: 'feature という枝を作り、そこへ移って 1 回コミットしてください。',
    setup: ['git init', 'git commit -m 根'],
    goal: ['git init', 'git commit -m 根', 'git switch -c feature', 'git commit -m 枝の上'],
    suggest: { branch: 'feature' },
    hints: [
      'git branch feature で作れますが、HEAD は動きません。',
      'git switch feature で移れます。',
      'git switch -c feature なら、作るのと移るのを一度にできます。',
    ],
  },
  {
    id: 'detached',
    title: 'detached HEAD',
    intro:
      'HEAD は枝ではなく、コミットを直に指すこともできます。それが detached HEAD で、事故ではなく 1 つのモードです。',
    task: '最初のコミットへ直接 checkout して、detached HEAD に入ってください。',
    setup: ['git init', 'git commit -m 一つ目', 'git commit -m 二つ目'],
    check: (s) => s.head.type === 'detached',
    hints: [
      'git log でコミットの id を確かめられます。',
      'git checkout <id> でそのコミットを直に指せます。',
      'switch は枝にしか移れません。コミットを指すには checkout か --detach です。',
    ],
  },
  {
    id: 'fast-forward',
    title: 'fast-forward マージ',
    intro:
      '分かれていない枝を取り込むとき、Git は合流点を作りません。名前を前へ滑らせるだけで済むからです。',
    task: 'main へ戻り、feature を取り込んでください。マージコミットは作られません。',
    setup: ['git init', 'git commit -m 根', 'git switch -c feature', 'git commit -m 枝の上'],
    goal: [
      'git init',
      'git commit -m 根',
      'git switch -c feature',
      'git commit -m 枝の上',
      'git switch main',
      'git merge feature',
    ],
    hints: [
      'まず git switch main で戻ります。',
      'git merge feature で取り込みます。',
      'main が feature の祖先なので、コミットは増えません。',
    ],
  },
  {
    id: 'three-way',
    title: '3-way マージ',
    intro:
      '両側がそれぞれコミットを持っていると、合流点が必要になります。親を 2 つ持つマージコミットです。',
    task: 'main で feature を取り込み、親が 2 つのコミットを作ってください。',
    setup: [
      'git init',
      'git commit -m 根',
      'git switch -c feature',
      'git commit -m 枝の上',
      'git switch main',
      'git commit -m 幹の上',
    ],
    check: (s) => {
      const head = headCommitId(s);
      return head !== null && s.commits[head].parents.length === 2;
    },
    hints: [
      'いま main にいます。git merge feature を打つだけです。',
      'グラフのその点に、線が 2 本入ってくるのが見えます。',
    ],
  },
  {
    id: 'conflict',
    title: 'コンフリクト ― 止まるだけで、壊れない',
    intro:
      '分かれたあと、両側が同じ行を変えていると、Git はどちらを残すか決められません。そのときマージは途中で止まり、ファイルには <<<<<<< という目印が書き込まれます。失敗ではなく、判断をこちらに渡してきただけです。',
    task: 'main で feature を取り込んでください。ぶつかったら、残す中身を決めてマージを完了させます。',
    setup: [
      'git init',
      'touch app.ts',
      'touch readme.md',
      'git add .',
      'git commit -m 根',
      'git switch -c feature',
      'edit app.ts 枝で直した 1 行目',
      'git add .',
      'git commit -m 枝で app.ts を直した',
      'git switch main',
      'edit app.ts 幹で直した 1 行目',
      'git add .',
      'git commit -m 幹でも app.ts を直した',
    ],
    check: (s) => {
      // 止まったまま終わっていないこと、そのうえで合流点ができていること
      if (s.pausing !== null) return false;
      const head = headCommitId(s);
      return head !== null && s.commits[head].parents.length === 2;
    },
    hints: [
      'まず git merge feature を打ってください。app.ts でぶつかって、そこで止まります。',
      '止まっている間は git status で状況を、git diff で書き込まれた目印を確かめられます。やめたくなったら git merge --abort でいつでも戻れます。',
      '残す中身を決めます。git checkout --ours app.ts か --theirs app.ts で片側を選ぶか、edit app.ts <文字列> で自分で書きます。',
      '決めたら git add app.ts です。目印が残ったままだと、add は断られます。',
      '全部片付いたら git commit です。親を 2 つ持つマージコミットができて、止まった状態が解けます。',
    ],
  },
  {
    id: 'reset-modes',
    title: 'reset の 3 つのモード',
    intro:
      '--soft / --mixed / --hard は、どれも枝を同じだけ動かします。違うのは、取り消した変更をどこまで巻き添えにするかだけです。',
    task: '直前のコミットを取り消しつつ、その中身はステージに残してください。',
    setup: [
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m 一つ目',
      'touch b.txt',
      'git add .',
      'git commit -m 二つ目',
    ],
    check: (s) =>
      s.index.some((f) => f.path === 'b.txt') &&
      s.workingDir.length === 0 &&
      Object.keys(s.commits).length === 2,
    hints: [
      'HEAD~1 は「1 つ前のコミット」です。',
      '中身をステージに残すモードはどれか、3 領域パネルで見比べてください。',
      'git reset --soft HEAD~1 です。',
    ],
  },
  {
    id: 'revert',
    title: 'revert ― 消さずに打ち消す',
    intro:
      'reset は履歴を後ろへ動かします。revert は履歴を 1 つも消さず、逆向きの変更を前に足します。共有した履歴を直せるのは後者だけです。',
    task: '直前のコミットを、履歴を消さずに打ち消してください。',
    setup: ['git init', 'git commit -m 一つ目', 'git commit -m 消したい変更'],
    goal: ['git init', 'git commit -m 一つ目', 'git commit -m 消したい変更', 'git revert HEAD'],
    hints: ['git revert HEAD です。', 'コミットが減るのではなく、増えることを確かめてください。'],
  },
  {
    id: 'stash',
    title: 'stash ― 脇へどける',
    intro:
      'コミットしたくないが、手元は片付けたい。そんなときに使います。このサイトで唯一、グラフが変わらないコマンドです。',
    task: '作業中の変更を退避して、作業ディレクトリとステージを空にしてください。',
    setup: ['git init', 'git commit -m 根', 'touch wip.txt'],
    check: (s) => s.stash.length === 1 && s.workingDir.length === 0 && s.index.length === 0,
    hints: ['git stash です。', 'グラフが 1 ミリも動かないことを確かめてください。'],
  },
  {
    id: 'cherry-pick',
    title: 'cherry-pick ― 1 つだけ摘む',
    intro: '枝ごと引っ越すのではなく、欲しいコミットを 1 つだけ持ってきます。',
    task: 'main へ戻り、feature にある「直したい不具合」だけを持ってきてください。',
    setup: [
      'git init',
      'git commit -m 根',
      'git switch -c feature',
      'git commit -m 直したい不具合',
      'git commit -m まだ途中',
      'git switch main',
    ],
    check: (s) => {
      const head = headCommitId(s);
      if (!head || s.head.type !== 'branch' || s.head.ref !== 'main') return false;
      const tip = s.commits[head];
      // main の先端が「直したい不具合」のコピーで、「まだ途中」は来ていないこと
      if (tip.message !== '直したい不具合') return false;
      const parent = tip.parents[0];
      return parent !== undefined && s.commits[parent].message === '根';
    },
    hints: [
      'git log では feature のコミットは見えません。git switch feature で確かめるか、グラフの id を読んでください。',
      'git cherry-pick <id> です。',
      '「まだ途中」まで持ってこないよう、id を 1 つだけ指定してください。',
    ],
  },
  {
    id: 'rebase',
    title: 'rebase ― 土台を置き直す',
    intro:
      'merge が合流させるのに対し、rebase はコミットをコピーし直します。id が変わる ＝ 別のコミットになります。',
    task: 'feature のコミットを、main の先端の上へ置き直してください。',
    setup: [
      'git init',
      'git commit -m 根',
      'git switch -c feature',
      'git commit -m 枝1',
      'git switch main',
      'git commit -m 幹1',
      'git switch feature',
    ],
    goal: [
      'git init',
      'git commit -m 根',
      'git switch -c feature',
      'git commit -m 枝1',
      'git switch main',
      'git commit -m 幹1',
      'git switch feature',
      'git rebase main',
    ],
    hints: [
      'git rebase main です。',
      'コピー元が薄い破線で残ります。消えたのではなく、指されなくなっただけです。',
    ],
  },
  {
    id: 'interactive',
    title: '対話的 rebase ― まとめる・落とす・並べ替える',
    intro:
      'git rebase -i は、置き直す前に「どう置き直すか」を書き換えられる rebase です。打った時点では、まだ履歴は何も変わっていません。',
    task:
      '3 つに分かれてしまった同じ作業を 1 つにまとめ、デバッグ用のコミットは落として、main の上へ置き直してください。',
    setup: [
      'git init',
      'touch shop.txt',
      'git add .',
      'git commit -m 開店',
      'git switch -c wrapping',
      'touch wrap.txt',
      'git add .',
      'git commit -m ラッピングを直した',
      'touch wrap2.txt',
      'git add .',
      'git commit -m typo',
      'touch debug.txt',
      'git add .',
      'git commit -m デバッグ用のログ',
      'git switch main',
      'touch price.txt',
      'git add .',
      'git commit -m 値札を差し替えた',
      'git switch wrapping',
    ],
    check: (s) => {
      if (s.todo !== null || s.pausing !== null) return false;
      const head = headCommitId(s);
      if (!head) return false;
      // main の上に 1 件だけ載っていて、debug.txt が入っていないこと
      const tip = s.commits[head];
      if (tip.parents.length !== 1) return false;
      const parent = s.commits[tip.parents[0]];
      if (parent.message !== '値札を差し替えた') return false;
      return (
        tip.tree['wrap.txt'] !== undefined &&
        tip.tree['wrap2.txt'] !== undefined &&
        tip.tree['debug.txt'] === undefined
      );
    },
    hints: [
      'git rebase -i main で計画を立てます。打っただけでは、まだ何も起きません。',
      '上に出る表で、2 行目を squash（1 つ上にまとめる）、3 行目を drop（落とす）にします。',
      'todo squash 2 と todo drop 3 でも同じことができます。',
      '決まったら todo run です（本物ならエディタを閉じるところです）。',
      'やめたくなったら git rebase --abort で、いつでも何も無かったことにできます。',
    ],
  },
  {
    id: 'reflog',
    title: 'reflog ― やらかしから戻る',
    intro:
      'reset --hard で切り離したコミットは消えていません。HEAD が通ってきた道の記録に、id が残っています。',
    task: '失くしたコミットを、「救出」という名前の枝で拾い直してください（main は戻したままにします）。',
    setup: [
      'git init',
      'git commit -m 一つ目',
      'git commit -m 二つ目',
      'git commit -m 大事な三つ目',
      'git reset --hard HEAD~1',
    ],
    check: (s) => {
      const rescue = s.branches.find((b) => b.name === '救出');
      const main = s.branches.find((b) => b.name === 'main');
      if (!rescue || !main) return false;
      return (
        s.commits[rescue.target]?.message === '大事な三つ目' &&
        s.commits[main.target]?.message === '二つ目'
      );
    },
    hints: [
      'git reflog で、通ってきた道が見られます。',
      '「いま辿れません」と付いた行の id が、失くしたコミットです。',
      'git switch -c 救出 <その id> で、いまの場所を壊さずに拾えます。',
    ],
  },
  {
    id: 'remote',
    title: 'リモート ― fetch と pull の違い',
    intro:
      '向こうのコミットは、fetch するまでこちらに存在しません。fetch は取ってくるだけで、手元の枝は動かしません。',
    task: '同僚のコミットを取り込んで、main を origin/main と同じところまで進めてください。',
    setup: [
      'git init',
      'git commit -m 一つ目',
      'git remote add origin https://example.com/repo.git',
      'git push origin main',
      'teammate 2',
    ],
    check: (s) => {
      // 向こうの「いまの」先端と比べる。
      // 追跡ブランチ（origin/main）は fetch するまで古いままなので、
      // そちらと比べると、何もしないうちから一致してしまう。
      const theirs = s.remotes[0]?.branches.find((b) => b.name === 'main')?.target;
      const main = s.branches.find((b) => b.name === 'main')?.target;
      const tracking = s.remoteBranches.find((r) => r.name === 'origin/main')?.target;
      return theirs !== undefined && main === theirs && tracking === theirs;
    },
    hints: [
      'git fetch origin だと、origin/main は動きますが main は動きません。',
      '取り込むところまでやるのが git pull です。',
      'git pull origin main です。',
    ],
  },
];

export function findLevel(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}

export function levelIndex(id: string): number {
  return LEVELS.findIndex((l) => l.id === id);
}
