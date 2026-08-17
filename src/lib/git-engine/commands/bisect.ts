import type { ParsedCommand } from '../parse';
import {
  ancestorsOf,
  fail,
  headCommitId,
  ok,
  recordReflog,
  requireRepo,
  resolveRevision,
  setHead,
} from '../state';
import { carryOver, wouldOverwrite } from './checkout';
import type { Bisect, CommandResult, RepoState } from '../types';

/**
 * `git bisect` — いつ壊れたかを、履歴を半分に割りながら探す。
 *
 *   git bisect start          探索を始める
 *   git bisect bad [<rev>]    ここは壊れている（省略すると、いまいる場所）
 *   git bisect good [<rev>]   ここは動いていた
 *   git bisect skip [<rev>]   この版は判定できない（ビルドが通らない等）
 *   git bisect log            これまでの判定
 *   git bisect reset          やめて、始める前の場所へ戻る
 *
 * このコマンドの値打ちは**回数**にある。
 * 100 個を 1 つずつ戻して試せば最悪 100 回だが、半分に割れば 7 回で足りる。
 * だから毎回「残り何個・あと約何回」を言う ― そこが伝わらないと、
 * 「HEAD~1 から順に checkout する」で済ませてしまう。
 *
 * 探し方も本物と同じにしてある。悪いのは 1 つ、良いのは何個でも持てて、
 * 探す範囲は「bad の祖先から、good の祖先を除いたもの」に決まる。
 */
export function bisect(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const sub = command.positional[0];
  const rest = command.positional.slice(1);

  if (!sub) return report(state);

  switch (sub) {
    case 'start':
      return start(state, rest);
    case 'good':
    case 'bad':
    case 'skip':
      return mark(state, sub, rest[0]);
    case 'reset':
      return reset(state);
    case 'log':
      return logOf(state);
    default:
      return fail(
        state,
        `git bisect ${sub} は使えません。`,
        '使えるのは start / good / bad / skip / log / reset です。',
      );
  }
}

/* ---- 範囲の計算 ---- */

function idsWith(b: Bisect, verdict: 'good' | 'bad' | 'skip'): string[] {
  return Object.keys(b.verdicts).filter((id) => b.verdicts[id] === verdict);
}

/**
 * まだ「最初に壊れたコミット」かもしれない範囲。
 *
 * bad の祖先から、どれかの good の祖先を除いたもの。bad 自身も入る
 * ― bad が範囲の 1 つ手前まで絞られたら、bad こそが犯人だから。
 */
export function bisectRange(state: RepoState, b: Bisect): string[] {
  if (!b.bad) return [];
  const inside = ancestorsOf(state, b.bad);
  for (const good of idsWith(b, 'good')) {
    for (const id of ancestorsOf(state, good)) inside.delete(id);
  }
  return [...inside];
}

/** 範囲のうち、まだ調べていないもの。bad 自身と、飛ばしたぶんは除く。 */
function untested(state: RepoState, b: Bisect): string[] {
  const skipped = new Set(idsWith(b, 'skip'));
  return bisectRange(state, b).filter((id) => id !== b.bad && !skipped.has(id));
}

/**
 * 次に調べるコミット。
 *
 * 候補ごとに「良かったら何個消えるか」「悪かったら何個消えるか」を数え、
 * **少ないほうがいちばん大きい**ものを選ぶ。
 * どちらに転んでも半分は減る、という選び方で、これが二分探索の要になっている。
 */
function pickNext(state: RepoState, pool: string[], range: string[]): string {
  const inRange = new Set(range);
  const total = range.length;

  let best = pool[0];
  let bestScore = -1;
  for (const id of pool) {
    // このコミットが good なら、その祖先はまとめて範囲から外れる
    let below = 0;
    for (const a of ancestorsOf(state, id)) if (inRange.has(a)) below += 1;
    const score = Math.min(below, total - below);
    // 同点なら新しいほうを選ぶ。並びが毎回同じになり、テストが安定する
    const newer = (state.commits[id]?.createdAt ?? 0) > (state.commits[best]?.createdAt ?? 0);
    if (score > bestScore || (score === bestScore && newer)) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/** 残り n 個を 1 個に絞るのに、あと何回かかるか。 */
function stepsLeft(n: number): number {
  return n <= 1 ? 0 : Math.ceil(Math.log2(n));
}

/* ---- 各サブコマンド ---- */

function start(state: RepoState, args: string[]): CommandResult {
  if (state.bisect) {
    return fail(
      state,
      'すでに二分探索の途中です。',
      'いまの状況は git bisect log、やめるなら git bisect reset です。',
    );
  }
  if (!headCommitId(state)) {
    return fail(state, 'まだコミットが 1 つもないので、探すものがありません。');
  }

  /*
   * 手元に片付いていない変更があるなら、始めさせない。
   *
   * bisect は HEAD を何度も動かして回る。1 回目は無事でも 3 回目で消える、
   * ということが起きるので、途中で詰まるより入口で断るほうがよい。
   * 本物の Git も同じ理由で、汚れた作業ディレクトリでは始められない。
   */
  const dirty = [
    ...state.index.map((f) => f.path),
    ...state.workingDir.filter((f) => f.status !== 'untracked' && f.status !== 'ignored').map((f) => f.path),
  ];
  if (dirty.length > 0) {
    return fail(
      state,
      `${[...new Set(dirty)].join(', ')} が、まだ片付いていません。`,
      'bisect は HEAD を何度も動かします。git commit するか git stash で脇へどけてください。',
    );
  }

  let next: Bisect = {
    bad: null,
    verdicts: {},
    testing: null,
    culprit: null,
    saved: state.head,
    entries: ['git bisect start'],
  };

  /*
   * git bisect start <bad> <good...> の形。
   * 最初の 1 つが悪いほう、残りが良いほう ― 本物と同じ並びにしておく。
   */
  const [badSpec, ...goodSpecs] = args;
  if (badSpec) {
    const resolved = resolve(state, badSpec);
    if (typeof resolved !== 'string') return resolved;
    next = { ...next, bad: resolved, verdicts: { [resolved]: 'bad' } };
    next.entries.push(`git bisect bad ${resolved}`);
  }
  for (const spec of goodSpecs) {
    const resolved = resolve(state, spec);
    if (typeof resolved !== 'string') return resolved;
    next = { ...next, verdicts: { ...next.verdicts, [resolved]: 'good' } };
    next.entries.push(`git bisect good ${resolved}`);
  }

  return advance(state, next, [
    '二分探索を始めました。',
    ...(badSpec ? [] : ['壊れているコミットと、動いていたコミットを教えてください。']),
  ]);
}

function mark(
  state: RepoState,
  verdict: 'good' | 'bad' | 'skip',
  spec: string | undefined,
): CommandResult {
  const b = state.bisect;
  if (!b) {
    return fail(
      state,
      'まだ二分探索を始めていません。',
      'git bisect start から始めてください。',
    );
  }
  if (b.culprit) {
    return fail(
      state,
      'もう見つかっています。',
      `最初に壊れたのは ${b.culprit} です。git bisect reset で戻れます。`,
    );
  }

  const target = spec ?? headCommitId(state);
  if (!target) return fail(state, 'どのコミットのことか分かりません。');

  const resolved = spec ? resolve(state, spec) : target;
  if (typeof resolved !== 'string') return resolved;

  const label = { good: '動いていた', bad: '壊れている', skip: '判定できない' }[verdict];
  let next: Bisect = {
    ...b,
    verdicts: { ...b.verdicts, [resolved]: verdict },
    entries: [...b.entries, `git bisect ${verdict} ${resolved}`],
  };
  // 悪いほうは範囲の上限そのもの。新しく悪いと分かったら、そこまで狭める
  if (verdict === 'bad') next = { ...next, bad: resolved };

  return advance(state, next, [`${resolved} を「${label}」として記録しました。`]);
}

/**
 * 判定を 1 つ受けたあとの続き。
 *
 * 足りないものを聞くか、次の 1 つへ移るか、犯人を告げるか。
 * 3 つの出口を 1 か所にまとめてあるのは、
 * start と good/bad/skip で言うことが変わらないようにするため。
 */
function advance(state: RepoState, b: Bisect, lines: string[]): CommandResult {
  const goods = idsWith(b, 'good');

  if (!b.bad || goods.length === 0) {
    const missing = !b.bad
      ? '壊れているところを git bisect bad で教えてください（省略すると、いまいる場所）。'
      : '動いていたところを git bisect good <コミット> で教えてください。';
    return ok({ ...state, bisect: b }, [...lines, missing], ['repo']);
  }

  const range = bisectRange(state, b);
  if (range.length === 0) {
    return fail(
      state,
      '良いほうが悪いほうの子孫になっています。',
      '良いのは古い側、悪いのは新しい側です。git bisect reset でやり直してください。',
    );
  }

  const pool = untested(state, b);

  if (pool.length === 0) {
    const skipped = idsWith(b, 'skip').filter((id) => range.includes(id));
    if (skipped.length > 0) {
      return ok(
        { ...state, bisect: { ...b, testing: null } },
        [
          ...lines,
          '残ったのは、飛ばしたコミットだけになりました。',
          `最初に壊れたのは ${[...skipped, b.bad].join(' / ')} のどれかです。ここから先は絞れません。`,
          'git bisect reset で戻れます。',
        ],
        ['repo'],
      );
    }
    return found(state, b, lines);
  }

  const target = pickNext(state, pool, range);
  const blocked = wouldOverwrite(state, target);
  if (blocked) return blocked;

  const from = headCommitId(state);
  let moved = setHead({ ...state, bisect: { ...b, testing: target } }, {
    type: 'detached',
    oid: target,
  });
  moved = carryOver(moved, target);
  moved = recordReflog(moved, 'bisect', `${target} を調べる`, from, target);

  const commit = state.commits[target];
  return ok(
    moved,
    [
      ...lines,
      `残り ${pool.length} 個。あと約 ${stepsLeft(pool.length)} 回で 1 つに絞れます。`,
      `${target}（${commit?.message ?? ''}）へ移りました。ここが動くか確かめてください。`,
      '動いていれば git bisect good、壊れていれば git bisect bad です。',
    ],
    ['repo', 'head', 'workingDir', 'index'],
  );
}

/** 絞り込みが終わった。 */
function found(state: RepoState, b: Bisect, lines: string[]): CommandResult {
  const culprit = b.bad as string;
  const commit = state.commits[culprit];
  const paths = commit?.paths ?? [];

  return ok(
    { ...state, bisect: { ...b, testing: null, culprit } },
    [
      ...lines,
      '',
      `最初に壊れたのは ${culprit} です。`,
      `  ${commit?.message ?? ''}`,
      ...(paths.length > 0 ? [`  変えたファイル: ${paths.join(', ')}`] : []),
      '',
      'ここまでで分かったのは「このコミットで壊れた」ところまでです。原因はこの中身を読んで探します。',
      'git bisect reset で、始める前の場所へ戻れます。',
    ],
    ['repo'],
  );
}

function reset(state: RepoState): CommandResult {
  const b = state.bisect;
  if (!b) return fail(state, 'いま二分探索はしていません。');

  const from = headCommitId(state);
  let next = setHead({ ...state, bisect: null }, b.saved);
  const back = headCommitId(next);

  if (back) next = carryOver(next, back);
  next = recordReflog(next, 'bisect', '探索をやめて戻る', from, back);

  return ok(
    next,
    [
      '二分探索をやめました。',
      b.saved.type === 'branch'
        ? `${b.saved.ref} へ戻りました。detached HEAD からも抜けています。`
        : `${b.saved.oid} へ戻りました。`,
      ...(b.culprit ? [`見つけた ${b.culprit} は、そのまま履歴に残っています。`] : []),
    ],
    ['head', 'workingDir', 'index'],
  );
}

function logOf(state: RepoState): CommandResult {
  const b = state.bisect;
  if (!b) {
    return fail(state, 'いま二分探索はしていません。', 'git bisect start から始めてください。');
  }
  return ok(state, [...b.entries, '', ...statusLines(state, b)], []);
}

function report(state: RepoState): CommandResult {
  const b = state.bisect;
  if (!b) {
    return ok(state, [
      '「いつ壊れたか」を、履歴を半分に割りながら探すコマンドです。',
      'git bisect start で始め、git bisect bad と git bisect good で範囲を挟みます。',
      '100 個のコミットでも 7 回で 1 つに絞れます。',
    ]);
  }
  return ok(state, statusLines(state, b), []);
}

/** いまの絞り込み具合。log と、素の git bisect の両方で出す。 */
function statusLines(state: RepoState, b: Bisect): string[] {
  if (b.culprit) return [`最初に壊れたのは ${b.culprit} です。git bisect reset で戻れます。`];
  if (!b.bad || idsWith(b, 'good').length === 0) {
    return ['まだ範囲が決まっていません。bad と good を 1 つずつ教えてください。'];
  }
  const pool = untested(state, b);
  return [
    `残り ${pool.length} 個。あと約 ${stepsLeft(pool.length)} 回です。`,
    ...(b.testing ? [`いま調べているのは ${b.testing} です。`] : []),
  ];
}

/** 指定をコミット id に直す。読めなければ、そのまま返せる断り文にする。 */
function resolve(state: RepoState, spec: string): string | CommandResult {
  const resolved = resolveRevision(state, spec);
  if (resolved === 'ambiguous') {
    return fail(state, `${spec} で始まるコミットが複数あります。`, 'もう少し長く書いてください。');
  }
  if (!resolved) {
    return fail(state, `${spec} という枝もコミットもありません。`, 'git log で確かめてください。');
  }
  return resolved;
}
