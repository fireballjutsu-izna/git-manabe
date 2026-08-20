import { copyTree, sameContent } from '../content';
import { hasFlag, type ParsedCommand } from '../parse';
import {
  currentBranchName,
  fail,
  findBranch,
  headCommitId,
  ok,
  recomputeTracked,
  recordReflog,
  requireRepo,
  resolveRevision,
  setBranch,
  setHead,
  treeOf,
} from '../state';
import type { CommandResult, FileState, RepoState } from '../types';

/**
 * `git checkout <branch|commit>` / `git switch <branch>`
 *
 * HEAD を動かし、作業ディレクトリとステージをその先の中身に入れ替える。
 *
 * 中身を持つようになったので、**移動でぶつかることがある** ―
 * まだコミットしていない変更が、移動先で上書きされてしまうときは断る。
 * 「switch する前に stash」が要る理由が、ここで手を動かして分かる。
 *
 * checkout と switch の違いも、そのまま再現する:
 *   checkout はコミットを直に指せて、その結果 detached HEAD になる
 *   switch は枝しか受け取らない（コミットを指すには --detach が要る）
 * この差は「detached HEAD は事故ではなく、意図して入るモード」という話に効いてくる。
 */
export function checkout(state: RepoState, command: ParsedCommand): CommandResult {
  return move(state, command, 'checkout');
}

export function switchCommand(state: RepoState, command: ParsedCommand): CommandResult {
  return move(state, command, 'switch');
}

function move(state: RepoState, command: ParsedCommand, as: 'checkout' | 'switch'): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  // git checkout --ours <path> / --theirs <path> は、移動ではなく「片側を選ぶ」
  if (hasFlag(command, '--ours', '--theirs')) {
    return takeSide(state, command, hasFlag(command, '--ours') ? 'ours' : 'theirs');
  }

  const creating = hasFlag(command, as === 'checkout' ? '-b' : '-c', '-B', '-C');
  const target = command.positional[0];

  /*
   * git checkout -- <path> は、移動ではなく「手元の変更を捨てる」。
   *
   * -- で区切るのは、枝の名前とファイル名が同じでも読み分けられるようにするため。
   * 区切りが無くても、枝でもコミットでもなく手元にあるファイルなら、そちらとして読む
   * ― 本物も同じ順で解く。
   */
  if (!creating && target !== undefined) {
    // パーサは - で始まるものを flags に入れるので、-- もそちらに来る
    const paths = command.positional;
    const separated = hasFlag(command, '--');
    if (separated || (paths.length > 0 && looksLikePaths(state, paths))) {
      return discard(state, paths);
    }
  }

  if (!target) {
    return fail(
      state,
      as === 'checkout' ? 'どこへ移るのか書いてください。' : 'どの枝へ移るのか書いてください。',
      as === 'checkout' ? '例: git checkout main' : '例: git switch main',
    );
  }

  // 2 つめの位置引数は「どこに生やすか」。
  // 省略すると HEAD。reflog で見つけた id をここに書くのが、失くしたコミットの拾い方。
  if (creating) return createAndMove(state, target, command.positional[1], as);

  const branch = findBranch(state, target);
  if (branch) return moveToBranch(state, target, branch.target);

  // 枝ではないので、コミットの指定として読む。
  // id そのものだけでなく HEAD~1 や origin/main も受ける
  // ― detached HEAD に入るいちばん普通の書き方が git checkout HEAD~1 なので。
  const detachAllowed = as === 'checkout' || hasFlag(command, '--detach');
  const resolved = resolveRevision(state, target);

  if (resolved === 'ambiguous') {
    return fail(
      state,
      `${target} で始まるコミットが複数あります。`,
      'もう少し長く書いてください。',
    );
  }
  if (!resolved) {
    return fail(
      state,
      `${target} という枝もコミットもありません。`,
      '枝の一覧は git branch、コミットの一覧は git log で見られます。',
    );
  }
  if (!detachAllowed) {
    return fail(
      state,
      `${target} は枝ではなくコミットです。switch は枝にしか移れません。`,
      `コミットを直接指すなら git switch --detach ${target} か git checkout ${target} です。`,
    );
  }

  return moveToCommit(state, resolved);
}

function createAndMove(
  state: RepoState,
  name: string,
  startPoint: string | undefined,
  as: 'checkout' | 'switch',
): CommandResult {
  if (findBranch(state, name)) {
    return fail(
      state,
      `${name} という枝はすでにあります。`,
      `移るだけなら git ${as === 'checkout' ? 'checkout' : 'switch'} ${name} です。`,
    );
  }

  let target: string | null;
  if (startPoint === undefined) {
    target = headCommitId(state);
  } else {
    const resolved = resolveRevision(state, startPoint);
    if (resolved === 'ambiguous') {
      return fail(
        state,
        `${startPoint} で始まるコミットが複数あります。`,
        'もう少し長く書いてください。',
      );
    }
    if (!resolved) {
      return fail(state, `${startPoint} という枝もコミットもありません。`);
    }
    target = resolved;
  }

  if (!target) {
    return fail(
      state,
      'まだコミットが 1 つもないので、枝を作れません。',
      '先に git commit を実行してください。',
    );
  }

  const blocked = wouldOverwrite(state, target);
  if (blocked) return blocked;

  const withBranch = setBranch(state, name, target);
  const from = headCommitId(withBranch);
  let next = setHead(withBranch, { type: 'branch', ref: name });
  next = carryOver(next, target);
  next = recordReflog(next, 'checkout', `${name} を作って移動`, from, target);

  return ok(
    next,
    [
      `${name} を ${target} に作り、そこへ移りました。`,
      ...(startPoint !== undefined
        ? ['どの枝からも辿れなくなっていたコミットも、こうして名前を付ければ拾い直せます。']
        : []),
    ],
    ['repo', 'head', 'workingDir', 'index'],
  );
}

function moveToBranch(state: RepoState, name: string, target: string): CommandResult {
  if (currentBranchName(state) === name) {
    return ok(state, [`すでに ${name} の上にいます。`], []);
  }

  const blocked = wouldOverwrite(state, target);
  if (blocked) return blocked;

  const from = headCommitId(state);
  const wasDetached = state.head.type === 'detached';

  let next = setHead(state, { type: 'branch', ref: name });
  next = carryOver(next, target);
  next = recordReflog(next, 'checkout', `${name} へ移動`, from, target);

  const lines = [`${name} へ移りました。`];
  if (wasDetached) {
    lines.push('detached HEAD から抜けました。HEAD はまた枝を指しています。');
  }
  lines.push('作業ディレクトリの中身も、この枝のものに入れ替わっています。');

  return ok(next, lines, ['head', 'workingDir', 'index']);
}

function moveToCommit(state: RepoState, oid: string): CommandResult {
  const from = headCommitId(state);
  if (state.head.type === 'detached' && state.head.oid === oid) {
    return ok(state, [`すでに ${oid} にいます。`], []);
  }

  const blocked = wouldOverwrite(state, oid);
  if (blocked) return blocked;

  let next = setHead(state, { type: 'detached', oid });
  next = carryOver(next, oid);
  next = recordReflog(next, 'checkout', `${oid} へ移動（detached）`, from, oid);

  return ok(
    next,
    [
      `${oid} へ移りました。いまは detached HEAD です。`,
      'HEAD がどの枝も指していない状態です。ここでコミットしても、どの枝も伸びません。',
      '枝に戻るには git switch <枝の名前> を実行してください。',
    ],
    ['head', 'workingDir', 'index'],
  );
}

/**
 * 移動すると消えてしまう変更があるなら、移動そのものを断る。
 *
 * 本物の Git と同じ判定 ― 手元で変えているファイルが、移動先で**別の中身**に
 * なっているときだけ止める。移動先で同じ中身なら、変更を持ったまま移れる。
 *
 * bisect も HEAD を動かして回るので、同じ判定を通す
 * ― 探している途中で手元の変更が消えては、探すどころではない。
 */
export function wouldOverwrite(state: RepoState, target: string): CommandResult | null {
  const here = treeOf(state, headCommitId(state));
  const there = treeOf(state, target);

  const dirty = [...state.workingDir, ...state.index].map((f) => f.path);
  const lost = [...new Set(dirty)].filter(
    (path) => !sameContent(here[path], there[path]) && !sameContent(state.work[path], there[path]),
  );

  if (lost.length === 0) return null;

  return fail(
    state,
    `${lost.join(', ')} の変更が、移動すると消えてしまいます。`,
    'git stash で脇へどけるか、git add と git commit で先に片付けてください。',
  );
}

/**
 * 移動先の中身に入れ替える。
 *
 * **片付いていない変更は、そのまま持っていく。**
 * ここへ来る前に wouldOverwrite を通しているので、残っているのは
 * 「移動先でも同じ中身のファイルへの変更」か「移動先が知らないファイル」だけ ―
 * どちらも本物の Git は消さずに持ち越す。
 *
 * 以前はここで「移動先の tree にあるものは持ち越さない」と早く抜けていた。
 * ほとんどのファイルは枝をまたいで同じ中身なので、
 * **ふつうに枝を移るだけで、書きかけが黙って消えていた**。
 * ステージに載せたぶんも同じで、こちらは本物も載せたまま持ち越す。
 */
export function carryOver(state: RepoState, target: string): RepoState {
  const there = treeOf(state, target);
  const work = copyTree(there);
  const stage = copyTree(there);
  const workingDir: FileState[] = [];
  const index: FileState[] = [];

  // ステージに載っているぶん。移動先の中身の上に、こちらの版を重ねる
  for (const f of state.index) {
    const mine = state.stage[f.path];
    if (mine === undefined) {
      // 「消す」がステージに載っている
      delete stage[f.path];
      index.push(f);
      continue;
    }
    stage[f.path] = [...mine];
    // 移動先が知らないファイルなら、追跡はこれからなので staged
    index.push(there[f.path] === undefined ? { path: f.path, status: 'staged' } : f);
  }

  // まだステージに載せていないぶん
  for (const f of state.workingDir) {
    const mine = state.work[f.path];
    if (mine === undefined) continue;
    work[f.path] = [...mine];
    workingDir.push(f);
  }
  // ステージに載せたものは、作業ディレクトリ側にも同じ中身が要る
  for (const f of index) {
    if (workingDir.some((w) => w.path === f.path)) continue;
    const mine = state.work[f.path] ?? state.stage[f.path];
    if (mine !== undefined) work[f.path] = [...mine];
  }

  return {
    ...state,
    work,
    stage,
    index,
    workingDir,
    tracked: recomputeTracked(state, target),
  };
}

/**
 * `git checkout --ours <path>` / `--theirs <path>`
 *
 * ぶつかったファイルで、片側をまるごと選ぶ。
 * 目印を手で消すより早く、「どちらを残すか」という判断だけに集中できる。
 *
 * これを打っただけでは決着したことにならない ― そのあとの git add が要る。
 * 「Git に伝える」のはいつでも add だ、という筋を崩さないため。
 */
function takeSide(state: RepoState, command: ParsedCommand, side: 'ours' | 'theirs'): CommandResult {
  const pausing = state.pausing;
  if (!pausing) {
    return fail(
      state,
      '--ours / --theirs は、ぶつかって止まっているときだけ使えます。',
      'いまは何も止まっていません。',
    );
  }

  const path = command.positional[0];
  if (!path) {
    return fail(state, 'どのファイルか書いてください。', `例: git checkout --${side} bouquet.txt`);
  }

  const conflict = pausing.conflicts.find((c) => c.path === path);
  if (!conflict) {
    const names = pausing.conflicts.map((c) => c.path);
    return fail(
      state,
      `${path} はぶつかっていません。`,
      names.length > 0 ? `決着待ちなのは ${names.join(', ')} です。` : 'ぶつかっているファイルはもうありません。',
    );
  }

  const chosen = side === 'ours' ? conflict.ours : conflict.theirs;
  const label = side === 'ours' ? 'こちら側' : `${pausing.from} 側`;

  return ok(
    { ...state, work: { ...state.work, [path]: [...chosen] } },
    [
      `${path} を ${label}の中身にしました。`,
      ...chosen.map((line) => `  ${line}`),
      '目印は消えました。ただし、これだけでは決着したことになりません。',
      `git add ${path} を打つと、Git に「これで確定」と伝わります。`,
    ],
    ['workingDir'],
  );
}

/** 引数がぜんぶ「手元にあるファイル」で、枝でもコミットでもないか。 */
function looksLikePaths(state: RepoState, paths: string[]): boolean {
  return paths.every(
    (p) =>
      resolveRevision(state, p) === null &&
      (state.work[p] !== undefined || state.stage[p] !== undefined || state.tracked.includes(p)),
  );
}

/**
 * `git checkout [--] <path>...` ― 手元の変更を捨てて、ステージの中身に戻す。
 *
 * reset との違いがここではっきりする。
 *   git reset <path>     ステージから降ろす。手元のファイルはそのまま
 *   git checkout <path>  手元のファイルを戻す。**書きかけは消える**
 * 戻す先はステージで、ステージに無ければ HEAD。
 *
 * このサイトで唯一「黙って手元の変更が消える」コマンドなので、消したことを必ず言う。
 */
function discard(state: RepoState, paths: string[]): CommandResult {
  if (paths.length === 0) {
    return fail(state, 'どのファイルを戻すのか書いてください。', '例: git checkout -- app.ts');
  }

  const head = treeOf(state, headCommitId(state));
  const unknown = paths.filter(
    (p) => state.stage[p] === undefined && head[p] === undefined && !state.tracked.includes(p),
  );
  if (unknown.length > 0) {
    return fail(
      state,
      `${unknown.join(', ')} は Git がまだ知らないファイルです。`,
      '一度も add していないファイルは、Git には戻す先がありません。手で消してください。',
    );
  }

  const work = { ...state.work };
  const restored: string[] = [];
  for (const path of paths) {
    const source = state.stage[path] ?? head[path];
    if (source === undefined) continue;
    if (sameContent(state.work[path], source)) continue;
    work[path] = [...source];
    restored.push(path);
  }

  if (restored.length === 0) {
    return ok(state, [`${paths.join(', ')} は、もうステージと同じ中身です。`], []);
  }

  return ok(
    { ...state, work, workingDir: state.workingDir.filter((f) => !restored.includes(f.path)) },
    [
      `${restored.join(', ')} を戻しました。`,
      '手元の書きかけは消えました。ここは取り消せません ― まだ Git に渡していない中身は、どこにも記録されていないからです。',
      'ステージに載せたぶんは残っています。そちらも降ろすなら git reset <path> です。',
    ],
    ['workingDir'],
  );
}
