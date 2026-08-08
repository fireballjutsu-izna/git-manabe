import { hasConflictMarkers, headCommitId } from '@/lib/git-engine';
import {
  areasClean,
  contains,
  containsCommit,
  depth,
  hasBranch,
  headParents,
  on,
  remoteTip,
  tipMessage,
  tipOf,
  trackingTip,
} from './helpers';
import type { Scenario } from './types';

/**
 * こえだ花店での 1 日。
 *
 * 場面は花屋、打つのは実務どおりの git。
 * ファイル名や枝の名前まで花屋の言葉にすると打ちにくいだけなので、
 * **言い換えるのは状況の説明だけ**にしてある。
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'hotfix',
    title: '開店前の差し替え',
    subtitle: '作業を中断して、緊急の修正を先に通す',
    intro:
      '新作の試作にとりかかったところで、店長から声がかかります。実務でいちばん多い割り込みの形で、stash・ブランチ・merge を一続きに使います。',
    setup: [
      'git init',
      'touch bouquet.txt',
      'git add .',
      'git commit -m 店頭のアレンジ',
      'git switch -c new-design',
      'touch sample.txt',
      'git add .',
    ],
    uses: ['stash', 'branch', 'fast-forward'],
    steps: [
      {
        from: '店長',
        message:
          'ごめん、店頭の花が傷んでる。開店までに差し替えたいんだけど、いまの試作はそのままにしておいて。',
        task: '作業中の変更を、いったん脇へどけてください。',
        check: (s) => s.stash.length === 1 && areasClean(s),
        hints: [
          'コミットしたくないけれど手元は片付けたい、というときに使うコマンドがあります。',
          'git stash です。グラフは 1 ミリも動きません。',
        ],
        par: 1,
      },
      {
        from: '店長',
        message: '直すのは店頭のぶんだけ。試作とは分けておいてね。',
        task: '店頭のアレンジ（main）へ戻り、hotfix という枝を切ってそこへ移ってください。',
        check: (s) => on(s, 'hotfix') && tipOf(s, 'hotfix') === tipOf(s, 'main'),
        hints: [
          'まず git switch main で戻ります。',
          'git switch -c hotfix で、作るのと移るのを一度にできます。',
        ],
        par: 2,
        suggest: { branch: 'hotfix' },
      },
      {
        from: '店長',
        message: '傷んでいるのは bouquet のところ。直したら記録に残しておいて。',
        task: 'bouquet.txt を直して、コミットしてください。',
        check: (s) => depth(s, 'hotfix') === depth(s, 'main') + 1 && areasClean(s),
        hints: [
          'edit bouquet.txt で、直したことにできます。',
          'そのあと git add bouquet.txt、git commit -m ... の順です。',
        ],
        par: 3,
        suggest: { file: 'bouquet.txt' },
      },
      {
        from: '店長',
        message: 'ありがとう。それを店頭に出して。',
        task: 'main へ戻り、hotfix を取り込んでください。',
        check: (s) => on(s, 'main') && contains(s, 'main', 'hotfix'),
        hints: [
          'git switch main で戻ります。',
          'git merge hotfix です。分かれていないので、コミットは増えません（fast-forward）。',
        ],
        par: 2,
      },
      {
        from: '店長',
        message: '助かった。試作の続き、やっちゃって。',
        task: 'new-design へ戻り、脇へどけておいた作業を戻してください。',
        check: (s) => on(s, 'new-design') && s.stash.length === 0 && !areasClean(s),
        hints: [
          'git switch new-design で戻ります。',
          'git stash pop で、退避したものが手元に戻ります。',
        ],
        par: 2,
      },
    ],
  },

  {
    id: 'review',
    title: '先輩の手直し',
    subtitle: 'レビューの指摘に応えて、履歴を整える',
    intro:
      '作ったものを見てもらうと、たいてい何か言われます。コミットのまとめ方と、入れてしまったものの取り消し方を練習します。',
    setup: [
      'git init',
      'git commit -m 開店',
      'git switch -c arrange',
      'touch stand.txt',
      'git add .',
      'git commit -m とりあえず置いた',
      'touch ribbon.txt',
      'git add .',
      'git commit -m 続き',
    ],
    uses: ['reset-modes', 'revert'],
    steps: [
      {
        from: '先輩',
        message:
          'コミットが 2 つに分かれてるけど、これ 1 つの作業だよね。あとから読む人が困るから、まとめてくれる？',
        task: '直近 2 つのコミットを、中身を残したまま 1 つにまとめ直してください。',
        check: (s) =>
          depth(s, 'arrange') === 2 && areasClean(s) && s.tracked.includes('ribbon.txt'),
        hints: [
          '枝を戻しても、中身をステージに残せるモードがあります。',
          'git reset --soft HEAD~2 で 2 つぶん戻し、中身はステージに残ります。',
          'そのあと git commit -m ... で、1 つにまとめて積み直します。',
        ],
        par: 2,
      },
      {
        from: '先輩',
        message:
          'あ、それとリボンは今回は無しで。ただ、もう共有しちゃったから履歴は消さないでね。取り消したことが分かる形で。',
        task: '直前のコミットを、履歴を消さずに打ち消してください。',
        check: (s) => depth(s, 'arrange') === 3 && headParents(s) === 1,
        hints: [
          '履歴を後ろへ動かす reset は、共有済みの履歴には使えません。',
          '逆向きの変更を前に足すコマンドがあります。',
          'git revert HEAD です。コミットが減るのではなく、増えます。',
        ],
        par: 1,
      },
      {
        from: '先輩',
        message: 'いいね、これで読める履歴になった。店頭に出しておいて。',
        task: 'main へ戻り、arrange を取り込んでください。',
        check: (s) => on(s, 'main') && contains(s, 'main', 'arrange'),
        hints: ['git switch main で戻ります。', 'git merge arrange です。'],
        par: 2,
      },
    ],
  },

  {
    id: 'behind',
    title: '本店の在庫が変わっていた',
    subtitle: 'push が断られたときの、正しい直し方',
    intro:
      'push でいちばん出会うエラーです。断られる理由は 1 つしかなく、直し方も 1 つしかありません。fetch と pull の違いがそのまま効いてきます。',
    setup: [
      'git init',
      'git commit -m 開店',
      'git remote add origin https://example.com/koeda.git',
      'git push origin main',
      'teammate 2',
      'touch card.txt',
      'git add .',
      'git commit -m メッセージカードを添えた',
    ],
    uses: ['remote'],
    steps: [
      {
        from: '本店',
        message: '在庫の内容を 2 件ぶん更新しました。お手元にも反映しておいてください。',
        task: '本店の様子を取ってきてください。まだ手元の店頭（main）は動かしません。',
        // 取ってきたが、手元の枝はまだ動いていないこと
        check: (s) =>
          trackingTip(s) === remoteTip(s, 'main') &&
          trackingTip(s) !== null &&
          !containsCommit(s, 'main', trackingTip(s)),
        hints: [
          '取ってくるだけのコマンドがあります。手元の枝は 1 つも動きません。',
          'git fetch origin です。',
        ],
        par: 1,
      },
      {
        from: '先輩',
        message: '取ってきただけだと、まだ店頭には並んでないよ。手元のぶんと合わせて。',
        task: '取ってきた本店のぶんを、main に取り込んでください。',
        check: (s) => containsCommit(s, 'main', trackingTip(s)),
        hints: [
          'origin/main は、いま手元にある「本店の記録」です。それを取り込みます。',
          'git merge origin/main です。両側が進んでいるので、合流点ができます。',
        ],
        par: 1,
      },
      {
        from: '店長',
        message: 'これで送れるはず。お願い。',
        task: '本店へ送ってください。',
        check: (s) => remoteTip(s, 'main') === tipOf(s, 'main'),
        hints: [
          '最初に断られたのは、向こうに知らないコミットがあったからです。もう取り込みました。',
          'git push origin main です。',
        ],
        par: 1,
      },
    ],
  },

  {
    id: 'wrong-branch',
    title: '店頭に直接手を入れてしまった',
    subtitle: 'main に直接コミットしてしまったときの戻し方',
    intro:
      '枝を切り忘れて、そのまま作業してしまった。よくあるやらかしですが、コミットは消えないので落ち着いて動かせば戻せます。',
    setup: [
      'git init',
      'git commit -m 開店',
      'touch winter.txt',
      'git add .',
      'git commit -m 冬の飾りつけ',
    ],
    uses: ['branch', 'reset-modes'],
    steps: [
      {
        from: '先輩',
        message:
          'それ、店頭のアレンジに直接入れちゃってるよ。まだ誰にも見せてないから直せる。まず、いまの作業に名前を付けて。',
        task: 'いまのコミットに winter という枝の名前を付けてください（まだ移りません）。',
        check: (s) => hasBranch(s, 'winter') && tipOf(s, 'winter') === tipOf(s, 'main'),
        hints: [
          'git branch <名前> は、いまのコミットに名前を付けるだけです。HEAD は動きません。',
          'git branch winter です。',
        ],
        par: 1,
        suggest: { branch: 'winter' },
      },
      {
        from: '先輩',
        message: '名前が付いたなら、店頭のほうは元に戻していいよ。作業は winter に残ってるから。',
        task: 'main を 1 つ前の状態へ戻してください。',
        check: (s) =>
          depth(s, 'main') === 1 &&
          depth(s, 'winter') === 2 &&
          tipMessage(s, 'winter') === '冬の飾りつけ',
        hints: [
          'reset は枝を後ろへ動かします。中身はもう winter にあるので、残す必要はありません。',
          'git reset --hard HEAD~1 です。',
          'コミットは消えません。winter から辿れます。',
        ],
        par: 1,
      },
      {
        from: '先輩',
        message: 'あとは winter で続けて。次からは先に枝を切ろうね。',
        task: 'winter へ移ってください。',
        check: (s) => on(s, 'winter'),
        hints: ['git switch winter です。'],
        par: 1,
      },
    ],
  },

  {
    id: 'clash',
    title: '二人が同じ花器を触った',
    subtitle: 'コンフリクトは、止まるだけで壊れていない',
    intro:
      'あなたが春の飾りに替えているあいだに、店長も同じ花器を生け直していました。同じ 1 行を二人が書き換えているので、Git はどちらを残すか決められません。そこで手を止め、ファイルには両方の案を並べて書き込みます。',
    setup: [
      'git init',
      'touch vase.txt',
      'touch table.txt',
      'git add .',
      'git commit -m 開店',
      'git switch -c spring',
      'edit vase.txt 春の花',
      'git add .',
      'git commit -m 春の花に替えた',
      'git switch main',
      'edit vase.txt 店長が生けた枝もの',
      'git add .',
      'git commit -m 店長が生け直した',
    ],
    uses: ['conflict', 'three-way'],
    steps: [
      {
        from: '店長',
        message: '春の飾り、いいね。店頭に入れちゃって。',
        task: 'main で spring を取り込んでください。おそらく、そのままでは終わりません。',
        check: (s) => s.pausing !== null,
        hints: [
          'git merge spring です。',
          '止まっても壊れていません。コミットは 1 つも増えていないはずです。',
        ],
        par: 1,
      },
      {
        from: '店長',
        message:
          'ああ、同じ花器を二人で触ってたか。ファイルを開くと、両方の案が <<<<<<< で区切って並んでるはず。どっちを残すか決めて、その目印は消しといて。',
        task: 'vase.txt から目印を消して、残す中身を 1 つに決めてください。',
        check: (s) => s.pausing !== null && !hasConflictMarkers(s.work['vase.txt']),
        hints: [
          'git diff を打つと、いま書き込まれている中身がそのまま読めます。',
          '片側をまるごと残すなら git checkout --ours vase.txt（店長の案）か --theirs vase.txt（春の花）です。',
          '自分で書くなら edit vase.txt <残したい中身> でも構いません。',
          'やめたくなったら git merge --abort で、始める前に戻せます。',
        ],
        par: 1,
        suggest: { file: 'vase.txt' },
      },
      {
        from: '店長',
        message: '決まった？ じゃあ、決めたってことを Git に伝えて。',
        task: 'ぶつかった vase.txt に、決着をつけた印を付けてください。',
        check: (s) => s.pausing !== null && s.pausing.conflicts.length === 0,
        hints: [
          '決着に専用のコマンドはありません。いつものコマンドが、その印を兼ねます。',
          'git add vase.txt です。',
          '目印が残ったままだと断られます。先に消してください。',
        ],
        par: 1,
        suggest: { file: 'vase.txt' },
      },
      {
        from: '店長',
        message: 'じゃあそれで確定して。',
        task: 'マージを完了させてください。',
        check: (s) => s.pausing === null && headParents(s) === 2 && on(s, 'main'),
        hints: [
          'git commit です。メッセージは省いても構いません。',
          '親を 2 つ持つコミットができて、止まっていた状態が解けます。',
        ],
        par: 1,
      },
    ],
  },


  {
    id: 'secret',
    title: '鍵を店先に出してしまった',
    subtitle: '.gitignore は、もう追跡しているものには効かない',
    intro:
      '本店とやりとりするための鍵を書いたファイルを、うっかり記録に混ぜたまま送ってしまいました。実務でいちばん肝が冷える事故です。止め方と、止めても消えないものを、順に見ていきます。',
    setup: [
      'git init',
      'touch order.txt',
      'touch .env  HONTEN_KEY=ひみつの合鍵',
      'git add .',
      'git commit -m 開店',
      'git remote add origin https://example.com/koeda.git',
      'git push origin main',
    ],
    uses: ['ignore', 'areas', 'remote'],
    steps: [
      {
        from: '先輩',
        message:
          'ちょっと待って。.env、本店に送るやつに混ざってない？ 中に合鍵書いてあるでしょ。まず追跡やめて。手元のファイルは消さないでね、使うから。',
        task: '.env を追跡から外してください。手元のファイルは残したままです。',
        check: (s) => s.stage['.env'] === undefined && s.work['.env'] !== undefined,
        hints: [
          '.gitignore に書くだけでは止まりません。もう追跡しているファイルには効かないからです。',
          'git rm --cached .env です。',
          '--cached を付けないとファイルごと消えます。手元では使い続けるので、付けてください。',
        ],
        par: 1,
        suggest: { file: '.env' },
      },
      {
        from: '先輩',
        message: 'そのままだと、次に git add . したらまた入るよ。無視するって書いといて。',
        task: '.gitignore を作って、.env を無視するように書いてください。',
        check: (s) => (s.work['.gitignore'] ?? []).some((line) => line.trim() === '.env'),
        hints: [
          'touch .gitignore で作れます。',
          'append .gitignore .env で 1 行足せます（edit は 1 行目を差し替えるので、こちらです）。',
          '書けると、3 領域のパネルで .env が薄くなります ― Git が見ていない印です。',
        ],
        par: 2,
        suggest: { file: '.gitignore' },
      },
      {
        from: '先輩',
        message: 'よし。それで記録して。',
        task: '.gitignore を含めてコミットしてください。',
        check: (s) => {
          const head = headCommitId(s);
          if (!head) return false;
          const tree = s.commits[head].tree;
          return tree['.env'] === undefined && tree['.gitignore'] !== undefined;
        },
        hints: [
          'git add .gitignore です。.env はもうステージに載っています（外したことが載っています）。',
          'そのあと git commit -m "..." です。',
          'git add . でも構いません。.env は無視されるので入りません。',
        ],
        par: 2,
      },
      {
        from: '先輩',
        message:
          'ここからが本題ね。いま消えたのは最新のコミットからだけ。git diff HEAD~1 HEAD を打ってみて ― .env が「消えた側」に出るでしょ。つまり 1 つ前にはまだ入ってる。push もしちゃってるから本店にも残ってる。履歴から本当に消す手はあるけど、それは全員の履歴を書き換える話で、消し終わるまで合鍵は有効なまま。だから先にやるのは合鍵の作り直しだよ。それが済めば、履歴に残ってるのはただの古い文字列。作り直しは僕がやっとくから、いまの状態を本店に送っといて。',
        task: '本店へ送ってください。その前に git diff HEAD~1 HEAD を見ておくと、話が腑に落ちます。',
        check: (s) => remoteTip(s, 'main') === tipOf(s, 'main'),
        hints: [
          'git diff HEAD~1 HEAD で、1 つ前に .env が入っていたことが確かめられます（手数には入りません）。',
          '送るのは git push origin main です。',
        ],
        par: 1,
      },
    ],
  },


  {
    id: 'showcase',
    title: '展示会の支度',
    subtitle: '必要な修正だけを持っていく',
    intro:
      '工房では試作がいくつも進んでいますが、展示会に出せるのは仕上がったものだけ。枝ごとではなく、必要な 1 つだけを摘んできます。そして、摘んだものを後から枝ごと取り込むと何が残るのかも、ここで見ます。',
    setup: [
      'git init',
      'git commit -m 開店',
      'git switch -c workshop',
      'git commit -m 試作1',
      'touch leaf.txt',
      'git add .',
      'git commit -m 傷んだ葉を直した',
      'git commit -m 試作2',
      'git switch main',
      'git remote add origin https://example.com/koeda.git',
    ],
    uses: ['cherry-pick', 'three-way'],
    steps: [
      {
        from: '店長',
        message:
          '展示会に出すのは店頭のアレンジ。ただ「傷んだ葉を直した」ぶんだけは入れておきたい。試作はまだ出せない。',
        task: 'workshop にある「傷んだ葉を直した」だけを、main へ持ってきてください。',
        check: (s) =>
          on(s, 'main') && tipMessage(s, 'main') === '傷んだ葉を直した' && depth(s, 'main') === 2,
        hints: [
          '枝ごと引っ越すのではなく、1 つだけ摘んでくるコマンドがあります。',
          'workshop のコミットもグラフに描かれています。「傷んだ葉を直した」の下にある id を読んでください（枝を移る必要はありません）。',
          'git cherry-pick <id> です。「試作2」まで持ってこないよう、1 つだけ指定します。',
        ],
        par: 1,
      },
      {
        from: '店長',
        message: '本店にも共有しておいて。展示会の担当が見るから。',
        task: '本店（origin）へ main を送ってください。',
        check: (s) => remoteTip(s, 'main') === tipOf(s, 'main'),
        hints: ['リモートはもう登録してあります。', 'git push origin main です。'],
        par: 1,
      },
      {
        from: '店長',
        message: '展示会おつかれさま。試作のほうも、もう全部入れちゃっていいよ。',
        task: 'workshop を main に取り込んでください。',
        check: (s) => s.pausing === null && headParents(s) === 2 && contains(s, 'main', 'workshop'),
        hints: [
          'git merge workshop です。',
          '摘んできたぶんと重なりますが、中身が同じなのでぶつかりません。',
        ],
        par: 1,
      },
      {
        from: '先輩',
        message:
          'すんなり入ったでしょ。cherry-pick は中身をコピーするだけだから、あとから枝ごと取り込んでも、同じ中身なら Git は黙って 1 つにする。ぶつかるのは「同じ行を違う中身にしたとき」だけ。ただ、グラフを見て。「傷んだ葉を直した」が 2 つ並んでるはず ― 摘んだ複製と、元のやつ。中身は同じでも別のコミットだから、両方残る。',
        task: 'グラフで、同じメッセージのコミットが 2 つあることを確かめてください。確かめたら、本店へ送ります。',
        check: (s) => remoteTip(s, 'main') === tipOf(s, 'main'),
        hints: [
          '「傷んだ葉を直した」が 2 行あります。id が違うのが分かります。',
          'git log --oneline でも並びが見られます。',
          '確かめたら git push origin main です。',
        ],
        par: 1,
      },
    ],
  },
];

export const findScenario = (id: string): Scenario | undefined =>
  SCENARIOS.find((s) => s.id === id);

export const scenarioIndex = (id: string): number => SCENARIOS.findIndex((s) => s.id === id);

/** 全ステップを合わせた手数の基準。一覧に出す。 */
export const totalPar = (scenario: Scenario): number =>
  scenario.steps.reduce((sum, step) => sum + step.par, 0);
