import { defaultContent, hasConflictMarkers } from '../content';
import { isIgnored } from '../ignore';
import { fail, isTracked, ok, pathExists, requireRepo } from '../state';
import type { ParsedCommand } from '../parse';
import type { CommandResult, FileStatus, RepoState } from '../types';

/** 位置引数の 2 つ目以降を、そのまま 1 行として読む。 */
function restText(command: ParsedCommand): string | undefined {
  const rest = command.positional.slice(1).join(' ').trim();
  return rest || undefined;
}

/**
 * `touch <path> [中身]` — Git のコマンドではない。
 *
 * 作業ディレクトリに、まだ Git が知らないファイルを 1 つ作る。
 * 本物の Git を触るときはエディタでファイルを作る操作にあたる。
 */
export function touch(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const path = command.positional[0];
  if (!path) {
    return fail(state, 'ファイル名を書いてください。', '例: touch hello.txt');
  }
  if (pathExists(state, path)) {
    return fail(
      state,
      `${path} はもうあります。`,
      isTracked(state, path)
        ? `変更したことにするなら edit ${path} を使ってください。`
        : '別の名前にしてください。',
    );
  }

  const text = restText(command);
  const content = text ? [text, '（ここに中身を書きます）'] : defaultContent(path);

  /*
   * .gitignore で無視されるファイルは untracked ではなく ignored。
   * 本物の git status にも出てこない ―「Git はこれを見ていない」を、
   * 状態の名前として持たせておく。
   */
  const ignored = isIgnored(state, path);
  const status: FileStatus = ignored ? 'ignored' : 'untracked';

  return ok(
    {
      ...state,
      work: { ...state.work, [path]: content },
      workingDir: [...state.workingDir, { path, status }],
    },
    [
      `${path} を作りました。`,
      `中身は ${content.length} 行です: ${content[0]}`,
      ignored
        ? '.gitignore に当たるので、Git はこのファイルを見ません（ignored）。git add しても入りません。'
        : 'Git はまだこのファイルを知りません（untracked）。',
    ],
    ['workingDir'],
  );
}

/**
 * `cat <path>` — Git のコマンドではない。
 *
 * 作業ディレクトリのファイルを、そのまま読む。
 *
 * これが無いと困る場面が 2 つある。
 * ぶつかって止まったとき ―「ファイルを開いたら <<<<<<< が入っていた」を
 * 実際に開いて確かめられない。もう 1 つが bisect で、
 * 移った先が壊れているかどうかは、中身を見ないと判定できない。
 */
export function cat(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const path = command.positional[0];
  if (!path) {
    return fail(state, 'ファイル名を書いてください。', '例: cat hello.txt');
  }

  const content = state.work[path];
  if (!content) {
    const here = Object.keys(state.work).sort();
    return fail(
      state,
      `${path} は、いまの作業ディレクトリにありません。`,
      here.length > 0 ? `あるのは ${here.join(', ')} です。` : 'まだ 1 つもファイルがありません。',
    );
  }

  return ok(state, [`${path}（${content.length} 行）`, ...content.map((line) => `  ${line}`)], []);
}

/**
 * `append <path> <行>` — Git のコマンドではない。
 *
 * ファイルの末尾に 1 行足す。edit が 1 行目を差し替えるのに対し、こちらは積む。
 * .gitignore のように**行を並べていく**ファイルのために置いている。
 */
export function append(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const path = command.positional[0];
  if (!path) {
    return fail(state, 'ファイル名を書いてください。', '例: append .gitignore .env');
  }

  const line = restText(command);
  if (!line) {
    return fail(state, '足す行を書いてください。', `例: append ${path} .env`);
  }

  const before = state.work[path] ?? state.stage[path];
  if (!before && !isTracked(state, path)) {
    return fail(
      state,
      `${path} がありません。`,
      `新しく作るなら touch ${path} ${line} です。`,
    );
  }

  const after = [...(before ?? []), line];
  const already = state.workingDir.some((f) => f.path === path);
  const status: FileStatus = isTracked(state, path)
    ? 'modified'
    : isIgnored(state, path)
      ? 'ignored'
      : 'untracked';

  return ok(
    {
      ...state,
      work: { ...state.work, [path]: after },
      workingDir: already ? state.workingDir : [...state.workingDir, { path, status }],
    },
    [`${path} に 1 行足しました: ${line}`, `いまは ${after.length} 行です。`],
    ['workingDir'],
  );
}

/**
 * `edit <path> [中身]` — Git のコマンドではない。
 *
 * 1 行目を書き換える。中身を省くと、そのときどきで違う 1 行になる ―
 * 別々の枝で同じファイルを edit すると、そこがそのままコンフリクトになる。
 *
 * 中身を書けば、自分で決着をつけることもできる。
 * コンフリクトの目印（<<<<<<< など）を消すのは、この edit の仕事。
 */
export function edit(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const path = command.positional[0];
  if (!path) {
    return fail(state, 'ファイル名を書いてください。', '例: edit hello.txt 春の花');
  }

  const current = state.work[path];
  if (!current && !isTracked(state, path)) {
    return fail(
      state,
      `${path} は、まだ一度もコミットされていません。`,
      `新しく作るなら touch ${path} を使ってください。`,
    );
  }

  const before = current ?? state.stage[path] ?? [path];
  const text = restText(command);

  /*
   * 中身の指定が無いときは、seq を混ぜた 1 行にする。
   * 「変更した」という印だけだった頃と使い勝手は同じだが、
   * 別々の枝で打つと必ず違う行になるので、コンフリクトが自然に起きる。
   */
  const line = text ?? `${path}（${state.seq + 1} 回目の変更）`;

  // 目印を消すための edit なら、丸ごと 1 行に置き換える。
  // 目印を残したまま 1 行目だけ書き換えても、決着したことにはならない
  const resolving = hasConflictMarkers(before);
  const after = resolving ? [line] : [line, ...before.slice(1)];

  const already = state.workingDir.some((f) => f.path === path);
  const status = isTracked(state, path) ? ('modified' as const) : ('untracked' as const);

  const lines = [`${path} の 1 行目を「${line}」にしました。`];
  if (resolving) {
    lines.push('コンフリクトの目印は、この書き換えで消えました。');
    lines.push(`決着をつけたことを Git に伝えるには git add ${path} です。`);
  } else if (already) {
    lines.push('すでに変更済みだったので、中身だけが変わりました。');
  } else {
    lines.push(
      status === 'modified'
        ? 'コミット済みのファイルへの変更なので modified です。'
        : 'まだコミットされていないファイルなので untracked のままです。',
    );
  }

  return ok(
    {
      ...state,
      seq: text ? state.seq : state.seq + 1,
      work: { ...state.work, [path]: after },
      workingDir: already ? state.workingDir : [...state.workingDir, { path, status }],
    },
    lines,
    ['workingDir'],
  );
}
