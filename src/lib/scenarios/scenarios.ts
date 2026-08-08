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
      'あなたが春の飾りに替えているあいだに、店長も同じ花器を生け直していました。Git はどちらを残すか決められないので、そこで手を止めます。',
    setup: [
      'git init',
      'touch vase.txt',
      'touch table.txt',
      'git add .',
      'git commit -m 開店',
      'git switch -c spring',
      'edit vase.txt',
      'git add .',
      'git commit -m 春の花に替えた',
      'git switch main',
      'edit vase.txt',
      'git add .',
      'git commit -m 店長が生け直した',
    ],
    uses: ['conflict', 'three-way'],
    steps: [
      {
        from: '店長',
        message: '春の飾り、いいね。店頭に入れちゃって。',
        task: 'main で spring を取り込んでください。おそらく、そのままでは終わりません。',
        check: (s) => s.merging !== null,
        hints: [
          'git merge spring です。',
          '止まっても壊れていません。コミットは 1 つも増えていないはずです。',
        ],
        par: 1,
      },
      {
        from: '店長',
        message:
          'ああ、同じ花器を二人で触ってたか。どちらを残すかは、あなたが決めて。決まったら Git に伝えて。',
        task: 'ぶつかった vase.txt に、決着をつけた印を付けてください。',
        check: (s) => s.merging !== null && s.merging.conflicts.length === 0,
        hints: [
          '決着に専用のコマンドはありません。いつものコマンドが、その印を兼ねます。',
          'git add vase.txt です。',
          'やめたくなったら git merge --abort で、始める前に戻せます。',
        ],
        par: 1,
        suggest: { file: 'vase.txt' },
      },
      {
        from: '店長',
        message: 'じゃあそれで確定して。',
        task: 'マージを完了させてください。',
        check: (s) => s.merging === null && headParents(s) === 2 && on(s, 'main'),
        hints: [
          'git commit です。メッセージは省いても構いません。',
          '親を 2 つ持つコミットができて、止まっていた状態が解けます。',
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
      '工房では試作がいくつも進んでいますが、展示会に出せるのは仕上がったものだけ。枝ごとではなく、必要な 1 つだけを摘んできます。そして、摘んだものを後から枝ごと取り込むと何が起きるのかも、ここで見ます。',
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
          'グラフから id を読むか、git switch workshop で git log を見て確かめてください。',
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
        task: 'workshop を main に取り込んでください。すんなりとはいかないかもしれません。',
        check: (s) => s.merging !== null,
        hints: [
          'git merge workshop です。',
          'ぶつかっても慌てないでください。コミットは 1 つも増えていません。',
        ],
        par: 1,
      },
      {
        from: '先輩',
        message:
          'ああ、それ摘んできたやつと重なってるんだ。cherry-pick は中身をコピーするから、あとから枝ごと取り込むと同じところを二度触ることになる。よくあるやつだよ。決着つけちゃって。',
        task: 'ぶつかった leaf.txt に印を付けて、マージを完了させてください。',
        check: (s) => s.merging === null && headParents(s) === 2 && contains(s, 'main', 'workshop'),
        hints: [
          'git add leaf.txt で、決着をつけた印を付けます。',
          'そのあと git commit でマージが完了します。',
        ],
        par: 2,
        suggest: { file: 'leaf.txt' },
      },
      {
        from: '店長',
        message: 'ありがとう。最後に本店へ送っておいて。',
        task: '本店へ送ってください。',
        check: (s) => remoteTip(s, 'main') === tipOf(s, 'main'),
        hints: ['git push origin main です。'],
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
