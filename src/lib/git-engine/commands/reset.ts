import { hasFlag, type ParsedCommand } from '../parse';
import {
  commitsBetween,
  currentBranchName,
  fail,
  headCommitId,
  ok,
  pathsIn,
  recomputeTracked,
  recordReflog,
  requireRepo,
  resolveRevision,
  setBranch,
  setHead,
} from '../state';
import type { Area, CommandResult, FileState, RepoState } from '../types';

type Mode = 'soft' | 'mixed' | 'hard';

/**
 * `git reset [--soft|--mixed|--hard] [<commit>]`
 *
 * 名前を共有している 3 つの別コマンド、と思ったほうが早い。
 * **どのモードでも枝は同じだけ動く。**違うのは、取り消したコミットに入っていた変更を
 * どこまで戻すか（＝どの領域を巻き添えにするか）だけ。
 *
 *              枝(HEAD)  ステージ  作業ディレクトリ
 *   --soft        動く     残す       残す      → 変更はステージに積まれたまま
 *   --mixed       動く     消す       残す      → 変更は「未ステージ」に落ちる（既定）
 *   --hard        動く     消す       消す      → 変更は消える。reflog でも戻せない
 *
 * この表を言葉で読むより、3 領域パネルのどこが光るかを見るほうが早い。
 * そのために touched をモードごとに変えている。
 */
export function reset(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const mode = pickMode(command);
  if (mode === 'conflict') {
    return fail(
      state,
      '--soft / --mixed / --hard は同時に指定できません。',
      '3 つは別々のコマンドだと思ってください。',
    );
  }

  const spec = command.positional[0] ?? 'HEAD';
  const head = headCommitId(state);
  if (!head) {
    return fail(
      state,
      'まだコミットが 1 つもないので、戻る先がありません。',
      'ステージを空にしたいだけなら、いまは何もしなくて大丈夫です。',
    );
  }

  const target = resolveRevision(state, spec);
  if (target === 'ambiguous') {
    return fail(state, `${spec} で始まるコミットが複数あります。`, 'もう少し長く書いてください。');
  }
  if (!target) {
    return fail(
      state,
      `${spec} という行き先が見つかりません。`,
      'HEAD~1 のように、いまの場所からさかのぼる書き方もできます。',
    );
  }

  // 取り消される（HEAD から辿れなくなる）コミットと、そこに入っていた変更
  const dropped = commitsBetween(state, target, head);
  const droppedPaths = pathsIn(state, dropped);

  let next = moveRef(state, target);
  const tracked = recomputeTracked(next, target);

  const { index, workingDir, touched, note } = applyMode(mode, next, droppedPaths, tracked);

  next = { ...next, index, workingDir, tracked };
  next = recordReflog(next, `reset --${mode}`, `${spec} へ戻す`, head, target);

  const lines = [
    `HEAD を ${target} に移しました（--${mode}）。`,
    dropped.length > 0
      ? `コミット ${dropped.length} 件が、ここから辿れなくなりました。`
      : '取り消されたコミットはありません。',
    note,
  ];

  if (mode === 'hard' && (droppedPaths.length > 0 || state.workingDir.length > 0)) {
    lines.push('--hard で消した作業中の変更は、reflog を使っても戻せません。');
  }
  if (dropped.length > 0) {
    lines.push('コミット自体はまだ残っています。reflog から辿り直せます（この章の先で扱います）。');
  }

  return ok(next, lines, ['head', ...touched]);
}

function pickMode(command: ParsedCommand): Mode | 'conflict' {
  const chosen: Mode[] = [];
  if (hasFlag(command, '--soft')) chosen.push('soft');
  if (hasFlag(command, '--mixed')) chosen.push('mixed');
  if (hasFlag(command, '--hard')) chosen.push('hard');
  if (chosen.length > 1) return 'conflict';
  return chosen[0] ?? 'mixed';
}

/** 枝の上なら枝ごと動かし、detached なら HEAD だけ動かす。 */
function moveRef(state: RepoState, target: string): RepoState {
  const branch = currentBranchName(state);
  return branch ? setBranch(state, branch, target) : setHead(state, { type: 'detached', oid: target });
}

/** 取り消した変更を、モードに応じて index / workingDir へ振り分ける。 */
function applyMode(
  mode: Mode,
  state: RepoState,
  droppedPaths: string[],
  tracked: string[],
): { index: FileState[]; workingDir: FileState[]; touched: Area[]; note: string } {
  // 戻した先から見て、そのパスが既知なら「変更された」、未知なら「新しいファイル」
  const asFile = (path: string, staged: boolean): FileState => ({
    path,
    status: staged ? 'staged' : tracked.includes(path) ? 'modified' : 'untracked',
  });

  if (mode === 'soft') {
    // ステージも作業ディレクトリもそのまま。取り消したぶんがステージに積み増される
    const existing = new Set(state.index.map((f) => f.path));
    const added = droppedPaths.filter((p) => !existing.has(p)).map((p) => asFile(p, true));
    return {
      index: [...state.index, ...added],
      workingDir: state.workingDir,
      touched: added.length > 0 ? ['index'] : [],
      note:
        droppedPaths.length > 0
          ? '取り消したコミットの中身は、ステージに残っています。すぐ commit し直せます。'
          : 'ステージと作業ディレクトリには手を付けていません。',
    };
  }

  if (mode === 'hard') {
    return {
      index: [],
      workingDir: [],
      touched: ['index', 'workingDir'],
      note: 'ステージも作業ディレクトリも空にしました。戻した先のコミットそのままの状態です。',
    };
  }

  // mixed（既定）: ステージは空にし、そこにあったものと取り消したぶんを作業ディレクトリへ落とす。
  //
  // ステージの中身を「消す」のではなく「降ろす」のが要点。
  // git reset を引数なしで打つ（＝ステージから外す）ときに変更ごと消えてしまうと、
  // いちばんよく使う使い方で作業を失うことになる。
  const kept = new Map<string, FileState>();
  for (const f of state.workingDir) kept.set(f.path, f);
  for (const f of state.index) if (!kept.has(f.path)) kept.set(f.path, asFile(f.path, false));
  for (const p of droppedPaths) if (!kept.has(p)) kept.set(p, asFile(p, false));

  return {
    index: [],
    workingDir: [...kept.values()],
    touched: ['index', 'workingDir'],
    note:
      droppedPaths.length > 0
        ? '取り消したコミットの中身は、ステージされていない変更として手元に残っています。'
        : 'ステージを空にしました。作業ディレクトリはそのままです。',
  };
}
