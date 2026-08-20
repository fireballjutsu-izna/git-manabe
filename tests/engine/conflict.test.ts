import { describe, expect, it } from 'vitest';
import { emptyState, headCommitId, run, type RepoState } from '@/lib/git-engine';

/**
 * コンフリクト。
 *
 * 確かめたいのは「止まる」「そこから 2 通りに抜けられる」の 2 点で、
 * どちらもデータの形で表せる ― pausing が入るか、消えるか。
 * 学習者が怖がるのは「壊れたかもしれない」なので、
 * **--abort が本当に元通りにする**ことは、特に強く固定しておく。
 *
 * ファイルの中身を持つようになったので、判定は**行**でする。
 * 同じファイルでも違う行ならぶつからない、が新しく効くところ。
 */

function play(lines: string[], from: RepoState = emptyState()): RepoState {
  let state = from;
  for (const line of lines) {
    const result = run(state, line);
    if (result.error) throw new Error(`「${line}」で失敗: ${result.error}`);
    state = result.state;
  }
  return state;
}

/** ぶつかっているパスの一覧。 */
function conflictPaths(state: RepoState): string[] {
  return (state.pausing?.conflicts ?? []).map((c) => c.path);
}

/** 両側が a.txt の 1 行目を変えた形。ここから merge するとぶつかる。 */
const CLASHING = [
  'git init',
  'touch a.txt',
  'touch b.txt',
  'git add .',
  'git commit -m 根',
  'git switch -c feature',
  'edit a.txt 枝の花',
  'git add .',
  'git commit -m 枝で a を変更',
  'git switch main',
  'edit a.txt 幹の花',
  'git add .',
  'git commit -m 幹で a を変更',
];

/** 両側が別のファイルを変えた形。分岐していてもぶつからない。 */
const SEPARATE = [
  'git init',
  'touch a.txt',
  'touch b.txt',
  'git add .',
  'git commit -m 根',
  'git switch -c feature',
  'edit a.txt 枝の花',
  'git add .',
  'git commit -m 枝で a を変更',
  'git switch main',
  'edit b.txt 幹の葉',
  'git add .',
  'git commit -m 幹で b を変更',
];

describe('ぶつかるかどうかの判定', () => {
  it('両側が同じ行を変えていたら止まる', () => {
    const result = run(play(CLASHING), 'git merge feature');

    expect(result.error).toBeUndefined();
    expect(conflictPaths(result.state)).toEqual(['a.txt']);
    expect(result.log.join('\n')).toContain('a.txt');
    expect(result.log.join('\n')).toContain('壊れてはいません');
  });

  it('別々のファイルなら、止まらずにマージできる', () => {
    const result = run(play(SEPARATE), 'git merge feature');

    expect(result.error).toBeUndefined();
    expect(result.state.pausing).toBeNull();
    const head = headCommitId(result.state) as string;
    expect(result.state.commits[head].parents).toHaveLength(2);
  });

  it('同じファイルでも、違う行なら止まらずに両方入る', () => {
    /*
     * ここがファイル単位だった頃との違い。記事が言い切っている行なので固定する。
     *
     * 前の期待値は枝を進めただけの fast-forward で、
     * 3-way マージを 1 度も通っていなかった ― 何も確かめていなかった。
     * いまは片側が 1 行目を直し、もう片側が末尾に 1 行足している。
     * 間に「（ここに中身を書きます）」が丸ごと残るので、変更は離れている。
     */
    const state = play([
      'git init',
      'touch a.txt 元の1行目',
      'git add .',
      'git commit -m 根',
      'git switch -c feature',
      'append a.txt 枝が足した行',
      'git add .',
      'git commit -m 枝で足す',
      'git switch main',
      'edit a.txt 幹が直した',
      'git add .',
      'git commit -m 幹で直す',
      'git merge feature',
    ]);

    expect(state.pausing).toBeNull();
    // 両側の変更が、どちらも入っている
    expect(state.work['a.txt']).toEqual([
      '幹が直した',
      '（ここに中身を書きます）',
      '枝が足した行',
    ]);
    expect(state.workingDir).toEqual([]);
  });

  it('両側が末尾に別々の行を足すと、足す場所が同じなので止まる', () => {
    /*
     * 「別々の行」に見えるが、どちらも末尾に割り込んでいるので場所は同じ。
     * 本物の git 2.43.0 も、この形は CONFLICT (content) で止める。
     */
    const state = play([
      'git init',
      'touch a.txt 元の1行目',
      'git add .',
      'git commit -m 根',
      'git switch -c feature',
      'append a.txt 枝が足した行',
      'git add .',
      'git commit -m 枝',
      'git switch main',
      'append a.txt 幹が足した行',
      'git add .',
      'git commit -m 幹',
      'git merge feature',
    ]);

    expect(conflictPaths(state)).toEqual(['a.txt']);
    // ぶつかったのは足した 1 行だけで、元の 2 行は目印の外に残る
    expect(state.work['a.txt']).toEqual([
      '元の1行目',
      '（ここに中身を書きます）',
      '<<<<<<< HEAD',
      '幹が足した行',
      '=======',
      '枝が足した行',
      '>>>>>>> feature',
    ]);
  });

  it('止まってもコミットは増えない', () => {
    const before = play(CLASHING);
    const after = run(before, 'git merge feature').state;
    expect(Object.keys(after.commits)).toHaveLength(Object.keys(before.commits).length);
  });

  it('止まっている間、枝はどれも動いていない', () => {
    const before = play(CLASHING);
    const after = run(before, 'git merge feature').state;
    expect(after.branches).toEqual(before.branches);
    expect(after.head).toEqual(before.head);
  });

  it('ぶつかったファイルは conflicted になる', () => {
    const state = play([...CLASHING, 'git merge feature']);
    expect(state.workingDir).toEqual([{ path: 'a.txt', status: 'conflicted' }]);
  });
});

describe('目印が書き込まれる', () => {
  const paused = () => play([...CLASHING, 'git merge feature']);

  it('作業ディレクトリのファイルに、本物と同じ目印が入る', () => {
    const state = paused();
    expect(state.work['a.txt']).toEqual([
      '<<<<<<< HEAD',
      '幹の花',
      '=======',
      '枝の花',
      '>>>>>>> feature',
      '（ここに中身を書きます）',
    ]);
  });

  it('目印が残ったままの add は断る', () => {
    const result = run(paused(), 'git add a.txt');
    expect(result.error).toContain('目印が残っています');
    expect(result.state.pausing).not.toBeNull();
  });

  it('git diff で、目印ごと中身が読める', () => {
    const text = run(paused(), 'git diff').log.join('\n');
    // ステージには「こちら側」が載っているので、増えたのは目印と向こう側の行
    expect(text).toContain('+<<<<<<< HEAD');
    expect(text).toContain('+=======');
    expect(text).toContain('+枝の花');
    expect(text).toContain('+>>>>>>> feature');
  });
});

/**
 * 止まったときの説明。
 *
 * 「両側が同じ行を変えています」と決め打ちしていた頃は、
 * 別々の行を足しただけのときも、片側が消しただけのときも同じ文を出していた ―
 * エンジンが自分で嘘をついていた。ぶつかり方ごとに言い分ける。
 */
describe('止まった理由の説明', () => {
  it('同じ行を変えたときは、同じ行だと言う', () => {
    const text = run(play(CLASHING), 'git merge feature').log.join('\n');
    expect(text).toContain('両側が同じ行を、別々の中身に変えています');
  });

  it('別々の行を同じ場所に足したときは、足したと言う', () => {
    const text = run(
      play([
        'git init',
        'touch a.txt 元の1行目',
        'git add .',
        'git commit -m 根',
        'git switch -c feature',
        'append a.txt 枝が足した行',
        'git add .',
        'git commit -m 枝',
        'git switch main',
        'append a.txt 幹が足した行',
        'git add .',
        'git commit -m 幹',
      ]),
      'git merge feature',
    ).log.join('\n');

    expect(text).toContain('両側が同じ場所に、別々の行を足しています');
    expect(text).not.toContain('同じ行を、別々の中身に');
  });

  it('片側が消して片側が変えたときは、消すか残すかだと言う', () => {
    const text = run(
      play([
        'git init',
        'touch a.txt 元の1行目',
        'git add .',
        'git commit -m 根',
        'git switch -c feature',
        'edit a.txt 枝が直した',
        'git add .',
        'git commit -m 枝',
        'git switch main',
        'git rm a.txt',
        'git commit -m 消した',
      ]),
      'git merge feature',
    ).log.join('\n');

    expect(text).toContain('片側がこのファイルを消し');
    expect(text).not.toContain('同じ行を、別々の中身に');
  });

  it('理由が 2 通りなら、2 通りとも言う', () => {
    const text = run(
      play([
        'git init',
        'touch a.txt 元',
        'touch b.txt 元',
        'git add .',
        'git commit -m 根',
        'git switch -c feature',
        'edit a.txt 枝の a',
        'append b.txt 枝が足した',
        'git add .',
        'git commit -m 枝',
        'git switch main',
        'edit a.txt 幹の a',
        'append b.txt 幹が足した',
        'git add .',
        'git commit -m 幹',
      ]),
      'git merge feature',
    ).log.join('\n');

    expect(text).toContain('両側が同じ行を、別々の中身に変えています');
    expect(text).toContain('両側が同じ場所に、別々の行を足しています');
  });
});

/**
 * 目印の見本。
 *
 * 各側の先頭 2 行を出していた頃は、ぶつかった箇所がファイルの下のほうにあると
 * 見本の両側がまったく同じ 2 行になった ―
 * 「どちらを残すか決めて」と言いながら、違いが見えていなかった。
 */
describe('目印の見本', () => {
  /** 4 行あるファイルの、末尾どうしがぶつかる形。違いは最後の 1 行だけ。 */
  const DEEP = [
    'git init',
    'touch v.txt 一',
    'append v.txt 三',
    'append v.txt 四',
    'git add .',
    'git commit -m 根',
    'git switch -c feature',
    'append v.txt 枝が足した行',
    'git add .',
    'git commit -m 枝',
    'git switch main',
    'append v.txt 幹が足した行',
    'git add .',
    'git commit -m 幹',
  ];

  it('下のほうでぶつかっても、違う行が見本に出る', () => {
    const text = run(play(DEEP), 'git merge feature').log.join('\n');
    expect(text).toContain('  幹が足した行');
    expect(text).toContain('  枝が足した行');
    // 両側に同じ「一」「三」が並ぶことはもう無い
    expect(text).not.toContain('  一');
    expect(text).not.toContain('  三');
  });

  it('どのファイルの見本かを言う', () => {
    // ファイル名は英数字で終わるので、そのあとに半角スペースが 1 つ入る
    expect(run(play(DEEP), 'git merge feature').log.join('\n')).toContain(
      'v.txt には、こういう目印が',
    );
  });

  it('片側が長いときは、頭だけ出して残りは行数で言う', () => {
    // 消した側と残した側。残した側は 5 行あるので、全部は出さない
    const text = run(
      play([
        'git init',
        'touch v.txt 一',
        'append v.txt 三',
        'append v.txt 四',
        'append v.txt 五',
        'git add .',
        'git commit -m 根',
        'git switch -c feature',
        'edit v.txt 枝が直した',
        'git add .',
        'git commit -m 枝',
        'git switch main',
        'git rm v.txt',
        'git commit -m 消した',
      ]),
      'git merge feature',
    ).log.join('\n');

    expect(text).toContain('  枝が直した');
    expect(text).toContain('…（ほか 2 行）');
  });
});

describe('片側をまるごと選ぶ', () => {
  const paused = () => play([...CLASHING, 'git merge feature']);

  it('--ours はこちら側を残す', () => {
    const result = run(paused(), 'git checkout --ours a.txt');
    expect(result.error).toBeUndefined();
    expect(result.state.work['a.txt']).toEqual(['幹の花', '（ここに中身を書きます）']);
    // 選んだだけでは決着していない。add がいる
    expect(conflictPaths(result.state)).toEqual(['a.txt']);
    expect(result.log.join('\n')).toContain('git add a.txt');
  });

  it('--theirs は向こう側を残す', () => {
    const state = run(paused(), 'git checkout --theirs a.txt').state;
    expect(state.work['a.txt']).toEqual(['枝の花', '（ここに中身を書きます）']);
  });

  it('選んだあとなら add が通る', () => {
    const state = play([...CLASHING, 'git merge feature', 'git checkout --ours a.txt', 'git add a.txt']);
    expect(conflictPaths(state)).toEqual([]);
  });

  it('edit で自分で書いても決着できる', () => {
    const state = play([
      ...CLASHING,
      'git merge feature',
      'edit a.txt 幹と枝を合わせた花',
      'git add a.txt',
    ]);
    expect(conflictPaths(state)).toEqual([]);
    expect(state.stage['a.txt']).toEqual(['幹と枝を合わせた花']);
  });

  it('ぶつかっていないファイルには使えない', () => {
    expect(run(paused(), 'git checkout --ours b.txt').error).toContain('ぶつかっていません');
  });

  it('止まっていないときは使えない', () => {
    expect(run(play(CLASHING), 'git checkout --ours a.txt').error).toContain(
      '止まっているときだけ',
    );
  });
});

describe('止まっている間にできること', () => {
  const paused = () => play([...CLASHING, 'git merge feature']);

  it('status がコンフリクトを知らせる', () => {
    const result = run(paused(), 'git status');
    const text = result.log.join('\n');
    expect(text).toContain('途中で止まっています');
    expect(text).toContain('両方が変更: a.txt');
  });

  it('関係のないコマンドは断られ、状態も変わらない', () => {
    const before = paused();
    for (const line of ['git switch feature', 'git reset --hard HEAD~1', 'git stash']) {
      const result = run(before, line);
      expect(result.error, line).toContain('マージの途中です');
      expect(result.state, line).toBe(before);
    }
  });

  it('もう 1 つマージを始めることはできない', () => {
    expect(run(paused(), 'git merge feature').error).toContain('マージの途中です');
  });

  it('rebase も cherry-pick も、いまは始められない', () => {
    expect(run(paused(), 'git rebase feature').error).toContain('マージの途中です');
    expect(run(paused(), 'git cherry-pick HEAD').error).toContain('マージの途中です');
  });

  /*
   * 断り文句が、止まっているものに合っていること。
   * merge だけ固定文で「マージの途中です」と言い、そのうえで
   * この状況では通らない git merge --abort を勧めていた。
   */
  it('cherry-pick で止まっているなら、cherry-pick のやめ方を案内する', () => {
    const base = play([
      'git init',
      'touch a.txt 元',
      'git add .',
      'git commit -m 根',
      'git switch -c feature',
      'edit a.txt 枝で',
      'git add .',
      'git commit -m 枝',
      'git switch main',
      'edit a.txt 幹で',
      'git add .',
      'git commit -m 幹',
    ]);
    const stopped = run(base, 'git cherry-pick feature').state;
    expect(stopped.pausing?.kind).toBe('cherry-pick');

    const refused = run(stopped, 'git merge feature');
    expect(refused.error).toContain('cherry-pick');
    expect(refused.log.join('\n')).toContain('git cherry-pick --abort');
    expect(refused.log.join('\n')).not.toContain('git merge --abort');
  });

  it('決着がつく前の commit は断る', () => {
    const result = run(paused(), 'git commit -m まだ');
    expect(result.error).toContain('まだ決着のついていないファイルがあります');
    expect(result.state.pausing).not.toBeNull();
  });

  it('log も diff も読める（履歴と中身を見て決めたいので）', () => {
    expect(run(paused(), 'git log').error).toBeUndefined();
    expect(run(paused(), 'git diff').error).toBeUndefined();
  });
});

describe('add で決着をつける', () => {
  it('add すると、残りが減る', () => {
    const result = run(
      play([...CLASHING, 'git merge feature', 'git checkout --ours a.txt']),
      'git add a.txt',
    );

    expect(result.error).toBeUndefined();
    expect(conflictPaths(result.state)).toEqual([]);
    expect(result.state.index).toEqual([{ path: 'a.txt', status: 'staged' }]);
    expect(result.log.join('\n')).toContain('git commit で先へ進めます');
  });

  it('2 件のうち 1 件だけ add すると、まだ止まったまま', () => {
    const two = [
      'git init',
      'touch a.txt',
      'touch b.txt',
      'git add .',
      'git commit -m 根',
      'git switch -c feature',
      'edit a.txt 枝の a',
      'edit b.txt 枝の b',
      'git add .',
      'git commit -m 枝で両方',
      'git switch main',
      'edit a.txt 幹の a',
      'edit b.txt 幹の b',
      'git add .',
      'git commit -m 幹で両方',
      'git merge feature',
    ];
    const state = play(two);
    expect(conflictPaths(state)).toEqual(['a.txt', 'b.txt']);

    const after = play(['git checkout --ours a.txt', 'git add a.txt'], state);
    expect(conflictPaths(after)).toEqual(['b.txt']);
    expect(run(after, 'git commit').error).toContain('b.txt');
  });
});

describe('commit でマージを終える', () => {
  const resolved = () =>
    play([...CLASHING, 'git merge feature', 'git checkout --ours a.txt', 'git add a.txt']);

  it('親を 2 つ持つコミットができて、止まった状態が解ける', () => {
    const result = run(resolved(), 'git commit');

    expect(result.error).toBeUndefined();
    expect(result.state.pausing).toBeNull();

    const head = headCommitId(result.state) as string;
    expect(result.state.commits[head].parents).toHaveLength(2);
    expect(result.state.commits[head].message).toBe("Merge branch 'feature'");
  });

  it('選んだ中身が、そのままコミットに入る', () => {
    const state = run(resolved(), 'git commit').state;
    const head = headCommitId(state) as string;
    expect(state.commits[head].tree['a.txt']).toEqual(['幹の花', '（ここに中身を書きます）']);
    // 目印はどこにも残っていない
    expect(state.work['a.txt']).toEqual(['幹の花', '（ここに中身を書きます）']);
  });

  it('main だけが動き、feature は置いていかれる', () => {
    const before = resolved();
    const featureBefore = before.branches.find((b) => b.name === 'feature')?.target;

    const state = run(before, 'git commit').state;
    expect(state.branches.find((b) => b.name === 'feature')?.target).toBe(featureBefore);
    expect(state.branches.find((b) => b.name === 'main')?.target).toBe(headCommitId(state));
  });

  it('ステージも作業ディレクトリも片付く', () => {
    const state = run(resolved(), 'git commit').state;
    expect(state.index).toEqual([]);
    expect(state.workingDir).toEqual([]);
  });

  it('メッセージを自分で付けることもできる', () => {
    const state = run(resolved(), 'git commit -m 手で直した').state;
    const head = headCommitId(state) as string;
    expect(state.commits[head].message).toBe('手で直した');
  });

  it('終わったあとは、普通のコマンドが通る', () => {
    const state = run(resolved(), 'git commit').state;
    expect(run(state, 'git switch feature').error).toBeUndefined();
  });
});

describe('--abort でやめる', () => {
  it('マージを始める前と、そっくり同じ状態に戻る', () => {
    const before = play(CLASHING);
    const after = run(play([...CLASHING, 'git merge feature']), 'git merge --abort').state;

    // seq（採番カウンタ）以外は完全に一致する ― コミットも枝も 3 領域も動いていない
    expect({ ...after, seq: 0 }).toEqual({ ...before, seq: 0 });
  });

  it('add したあとでも戻れる', () => {
    const before = play(CLASHING);
    const after = run(
      play([...CLASHING, 'git merge feature', 'git checkout --ours a.txt', 'git add a.txt']),
      'git merge --abort',
    ).state;

    expect(after.pausing).toBeNull();
    expect(after.index).toEqual(before.index);
    expect(after.workingDir).toEqual(before.workingDir);
    // 書き込まれた目印も、選んだ中身も残っていない
    expect(after.work['a.txt']).toEqual(before.work['a.txt']);
  });

  it('止まっていないときの --abort は断る', () => {
    expect(run(play(CLASHING), 'git merge --abort').error).toContain('マージの途中ではありません');
  });
});

/**
 * merge 以外でも止まる。
 *
 * 実務でいちばん痛いのは rebase の途中で止まることなので、
 * 「1 件ずつ当て直すから、何回も止まりうる」ところまで固定しておく。
 */
describe('rebase の途中で止まる', () => {
  /** feature に 2 件あり、どちらも main とぶつかる。 */
  const REBASE_CLASH = [
    'git init',
    'touch a.txt',
    'git add .',
    'git commit -m 根',
    'git switch -c feature',
    'edit a.txt 枝 1',
    'git add .',
    'git commit -m 枝の 1 つ目',
    'edit a.txt 枝 2',
    'git add .',
    'git commit -m 枝の 2 つ目',
    'git switch main',
    'edit a.txt 幹',
    'git add .',
    'git commit -m 幹の変更',
    'git switch feature',
  ];

  it('1 件目でぶつかって止まる', () => {
    const result = run(play(REBASE_CLASH), 'git rebase main');
    expect(result.error).toBeUndefined();
    expect(result.state.pausing?.kind).toBe('rebase');
    expect(conflictPaths(result.state)).toEqual(['a.txt']);
    expect(result.log.join('\n')).toContain('git rebase --continue');
  });

  it('続けるのは commit ではなく --continue', () => {
    const paused = play([...REBASE_CLASH, 'git rebase main']);
    expect(run(paused, 'git commit -m x').error).toContain('git commit ではありません');
  });

  it('向こう側を採ると、2 件目はぶつからずに終わる', () => {
    /*
     * 1 件目で「枝 1」を選ぶと、2 件目から見れば
     * 分岐点（枝 1）と手元（枝 1）が同じ ― 片側しか変えていない形になる。
     * だから 2 件目は黙って通る。決着のつけ方が、後続の止まり方を変える。
     */
    const done = play([
      ...REBASE_CLASH,
      'git rebase main',
      'git checkout --theirs a.txt',
      'git add a.txt',
      'git rebase --continue',
    ]);

    expect(done.pausing).toBeNull();
    const head = headCommitId(done) as string;
    expect(done.commits[head].message).toBe('枝の 2 つ目');
    expect(done.commits[done.commits[head].parents[0]].message).toBe('枝の 1 つ目');
  });

  it('こちら側を採ると、2 件目でまた止まる', () => {
    // 「幹」を残すと、2 件目（枝 1 → 枝 2）から見て 3 つとも別物になる
    const first = play([
      ...REBASE_CLASH,
      'git rebase main',
      'git checkout --ours a.txt',
      'git add a.txt',
    ]);
    expect(conflictPaths(first)).toEqual([]);

    const second = run(first, 'git rebase --continue');
    expect(second.error).toBeUndefined();
    expect(second.state.pausing?.kind).toBe('rebase');
    expect(conflictPaths(second.state)).toEqual(['a.txt']);
    expect(second.log.join('\n')).toContain('残り 1 件');
  });

  it('2 回止まっても、片付ければ最後まで終わる', () => {
    const done = play([
      ...REBASE_CLASH,
      'git rebase main',
      'git checkout --ours a.txt',
      'git add a.txt',
      'git rebase --continue',
      'git checkout --theirs a.txt',
      'git add a.txt',
      'git rebase --continue',
    ]);

    expect(done.pausing).toBeNull();
    const head = headCommitId(done) as string;
    expect(done.commits[head].message).toBe('枝の 2 つ目');
    expect(done.commits[done.commits[head].parents[0]].message).toBe('枝の 1 つ目');
  });

  it('--abort で置き直す前に戻る', () => {
    const before = play(REBASE_CLASH);
    const after = run(play([...REBASE_CLASH, 'git rebase main']), 'git rebase --abort').state;

    expect(after.pausing).toBeNull();
    expect(after.branches.find((b) => b.name === 'feature')?.target).toBe(
      before.branches.find((b) => b.name === 'feature')?.target,
    );
    expect(after.head).toEqual(before.head);
    expect(after.workingDir).toEqual(before.workingDir);
  });

  it('ぶつからなければ、いままでどおり一気に終わる', () => {
    const state = play([
      'git init',
      'touch a.txt',
      'git add .',
      'git commit -m 根',
      'git switch -c feature',
      'touch f.txt',
      'git add .',
      'git commit -m 枝',
      'git switch main',
      'touch m.txt',
      'git add .',
      'git commit -m 幹',
      'git switch feature',
      'git rebase main',
    ]);
    expect(state.pausing).toBeNull();
  });
});

describe('cherry-pick の途中で止まる', () => {
  const PICK_CLASH = [
    'git init',
    'touch a.txt',
    'git add .',
    'git commit -m 根',
    'git switch -c feature',
    'edit a.txt 枝の花',
    'git add .',
    'git commit -m 枝の変更',
    'git switch main',
    'edit a.txt 幹の花',
    'git add .',
    'git commit -m 幹の変更',
  ];

  it('摘んだ先とぶつかると止まる', () => {
    const state = play(PICK_CLASH);
    const featureTip = state.branches.find((b) => b.name === 'feature')?.target as string;
    const result = run(state, `git cherry-pick ${featureTip}`);

    expect(result.error).toBeUndefined();
    expect(result.state.pausing?.kind).toBe('cherry-pick');
    expect(result.log.join('\n')).toContain('git cherry-pick --continue');
  });

  it('--continue で 1 件のコミットになる', () => {
    const state = play(PICK_CLASH);
    const featureTip = state.branches.find((b) => b.name === 'feature')?.target as string;
    const done = play(
      [
        `git cherry-pick ${featureTip}`,
        'git checkout --theirs a.txt',
        'git add a.txt',
        'git cherry-pick --continue',
      ],
      state,
    );

    expect(done.pausing).toBeNull();
    const head = headCommitId(done) as string;
    expect(done.commits[head].message).toBe('枝の変更');
    expect(done.commits[head].tree['a.txt']).toEqual(['枝の花', '（ここに中身を書きます）']);
  });

  it('--abort で摘む前に戻る', () => {
    const before = play(PICK_CLASH);
    const featureTip = before.branches.find((b) => b.name === 'feature')?.target as string;
    const after = run(
      play([`git cherry-pick ${featureTip}`], before),
      'git cherry-pick --abort',
    ).state;

    expect(after.pausing).toBeNull();
    expect(after.head).toEqual(before.head);
    expect(after.work).toEqual(before.work);
  });
});

describe('決定性', () => {
  it('同じ手順を 2 回流すと、同じ状態になる', () => {
    const lines = [
      ...CLASHING,
      'git merge feature',
      'git checkout --ours a.txt',
      'git add a.txt',
      'git commit',
    ];
    expect(play(lines)).toEqual(play(lines));
  });
});
