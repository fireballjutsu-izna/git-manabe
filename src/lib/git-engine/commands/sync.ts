import { hasFlag, type ParsedCommand } from '../parse';
import {
  ancestorsOf,
  currentBranchName,
  fail,
  findBranch,
  isAncestor,
  ok,
  recomputeTracked,
  requireRepo,
  setRemoteBranch,
} from '../state';
import type { Commit, CommandResult, Remote, RepoState } from '../types';
import { pickRemote, trackingName } from './remote';
import { merge } from './merge';

/**
 * `git push [remote] [branch]`
 *
 * 手元のコミットを、向こうへ複製する。
 *
 * **早送りにならない push は断られる。**これが push でいちばん出会うエラーで、
 * 「向こうに、こちらの知らないコミットがある」という意味しかない。
 * 直し方はふつう 1 つ ― 先に pull して、相手のぶんを取り込んでから送る。
 *
 * ただし rebase のあとだけは事情が違う。**自分で履歴を書き換えたのだから、
 * 向こうのほうが古い**。ここでだけ、押し出すための指定がある:
 *
 *   --force              問答無用で上書きする
 *   --force-with-lease   「自分が最後に見たときから向こうが動いていなければ」上書きする
 *
 * 後者を使う。前者は、間に誰かが push していたらそれを消してしまう。
 */
export function push(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const target = pickRemote(state, command.positional[0]);
  if (!target) {
    return fail(state, 'リモートがありません。', '先に git remote add origin <url> です。');
  }

  const branch = command.positional[1] ?? currentBranchName(state);
  if (!branch) {
    return fail(state, 'detached HEAD では push できません。', '送る枝の名前が決まらないためです。');
  }

  const local = findBranch(state, branch)?.target ?? null;
  if (!local) return fail(state, `${branch} という枝がありません。`);

  const theirs = target.branches.find((b) => b.name === branch)?.target ?? null;

  if (theirs === local) {
    return ok(state, [`${target.name}/${branch} は、すでに同じところを指しています。`], []);
  }

  const force = hasFlag(command, '--force', '-f');
  const lease = hasFlag(command, '--force-with-lease');
  const notes: string[] = [];

  // 向こうの先端がこちらから辿れない ＝ こちらの知らないコミットを持っている
  if (theirs && !isAncestor(state, theirs, local)) {
    if (!force && !lease) {
      return fail(
        state,
        `${target.name} の ${branch} には、あなたが持っていないコミットがあります。`,
        rewrote(state, target.name, branch, theirs)
          ? `向こうは動いていないので、これは自分で履歴を書き換えたぶんです。git push --force-with-lease ${target.name} ${branch} で押し出せます。`
          : `先に git pull ${target.name} ${branch} で取り込んでから、送り直してください。`,
      );
    }

    /*
     * --force-with-lease の「lease（借り）」。
     *
     * 自分が最後に見た向こうの位置（origin/xxx）と、向こうの実際の位置を比べる。
     * ずれていれば、自分が見ていないあいだに誰かが push している ―
     * そこへ --force をかけると、その人の作業が消える。だからここで止める。
     */
    if (lease && !force) {
      const seen = state.remoteBranches.find(
        (r) => r.name === trackingName(target.name, branch),
      )?.target;
      if (seen !== theirs) {
        return fail(
          state,
          `${target.name} の ${branch} は、あなたが最後に見たときから動いています。`,
          `いま押し出すと、その変更が消えます。先に git fetch ${target.name} で確かめてください。`,
        );
      }
    }

    // 向こうにしかないコミットは、この push でどこからも辿れなくなる
    const losing = [...ancestorsOf({ ...state, commits: target.commits }, theirs)].filter(
      (id) => !ancestorsOf(state, local).has(id),
    );
    notes.push(
      force && !lease
        ? '--force なので、向こうの状態を確かめずに上書きしました。'
        : '最後に見たときから向こうが動いていなかったので、押し出しました。',
    );
    if (losing.length > 0) {
      notes.push(
        `向こうにあった ${losing.length} 件は、これでどこからも辿れなくなります（書き換える前の版です）。`,
      );
    }
    notes.push('ほかの人がこの枝を持っていると、その手元と食い違います。共有前だけにしてください。');
  }

  // 向こうに足りないコミットだけを複製する
  const theirCommits = theirs ? ancestorsOf(state, theirs) : new Set<string>();
  const sending = [...ancestorsOf(state, local)].filter((id) => !theirCommits.has(id));

  const copied: Record<string, Commit> = { ...target.commits };
  for (const id of sending) copied[id] = state.commits[id];

  const nextRemote: Remote = {
    ...target,
    commits: copied,
    branches: theirs
      ? target.branches.map((b) => (b.name === branch ? { ...b, target: local } : b))
      : [...target.branches, { name: branch, target: local }],
  };

  let next: RepoState = {
    ...state,
    remotes: state.remotes.map((r) => (r.name === target.name ? nextRemote : r)),
  };
  // 送ったのだから、向こうがどこを指しているかは分かっている
  next = setRemoteBranch(next, trackingName(target.name, branch), local);

  return ok(
    next,
    [
      `${sending.length} 件を ${target.name} の ${branch} へ送りました。`,
      `${trackingName(target.name, branch)} も一緒に動きました ― 送った先が分かっているからです。`,
      ...(theirs ? [] : [`${target.name} に ${branch} を新しく作りました。`]),
      ...notes,
    ],
    ['repo'],
  );
}

/**
 * 食い違いの原因が「自分が書き換えたから」か、「向こうが進んだから」か。
 *
 * 断り文句の出し分けに使う。案内を間違えると害が大きい ―
 * 書き換えたあとに pull すると、捨てたはずの古い版がまた入ってくる。
 *
 * 見分け方は 1 つで足りる。**自分が最後に見た向こうの位置**（origin/xxx）と、
 * 向こうの実際の位置が同じなら、動いたのはこちらだけ ＝ 自分の書き換え。
 * ずれていれば、誰かが push している ＝ pull が要る。
 */
function rewrote(state: RepoState, remote: string, branch: string, theirs: string): boolean {
  const seen = state.remoteBranches.find((r) => r.name === trackingName(remote, branch))?.target;
  return seen === theirs;
}

/**
 * `git fetch [remote]`
 *
 * 向こうのコミットを持ってくる。**手元の枝は 1 つも動かさない。**
 *
 * pull との違いはここだけで、fetch は「取ってくるだけ」。
 * origin/main は動くが main は動かない、という状態がその証拠になる。
 */
export function fetch(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const target = pickRemote(state, command.positional[0]);
  if (!target) {
    return fail(state, 'リモートがありません。', '先に git remote add origin <url> です。');
  }

  const { state: next, added, moved } = fetchInto(state, target);

  if (added === 0 && moved.length === 0) {
    return ok(next, [`${target.name} に新しいものはありませんでした。`], []);
  }

  return ok(
    next,
    [
      `${target.name} から ${added} 件のコミットを取ってきました。`,
      ...moved.map((m) => `  ${m}`),
      'あなたの枝は 1 つも動いていません。fetch は「取ってくるだけ」です。',
      '取り込むには git merge か、最初から git pull を使います。',
    ],
    added > 0 || moved.length > 0 ? ['repo'] : [],
  );
}

/** fetch の中身。pull からも使う。 */
function fetchInto(
  state: RepoState,
  target: Remote,
): { state: RepoState; added: number; moved: string[] } {
  const commits = { ...state.commits };
  let added = 0;
  for (const [id, commit] of Object.entries(target.commits)) {
    if (!commits[id]) {
      commits[id] = commit;
      added += 1;
    }
  }

  let next: RepoState = { ...state, commits };
  const moved: string[] = [];

  for (const b of target.branches) {
    const name = trackingName(target.name, b.name);
    const before = next.remoteBranches.find((r) => r.name === name)?.target;
    if (before !== b.target) {
      moved.push(`${name} → ${b.target}`);
      next = setRemoteBranch(next, name, b.target);
    }
  }

  return { state: next, added, moved };
}

/**
 * `git pull [remote] [branch]`
 *
 * fetch してから merge する。それだけ。
 * 2 つのコマンドの合成であることを、ログでも見せる。
 */
export function pull(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const target = pickRemote(state, command.positional[0]);
  if (!target) {
    return fail(state, 'リモートがありません。', '先に git remote add origin <url> です。');
  }

  const branch = command.positional[1] ?? currentBranchName(state);
  if (!branch) {
    return fail(state, 'detached HEAD では pull できません。', '取り込む先の枝が決まらないためです。');
  }

  const fetched = fetchInto(state, target);
  const tracking = trackingName(target.name, branch);
  const remoteTip = fetched.state.remoteBranches.find((r) => r.name === tracking)?.target;

  if (!remoteTip) {
    return fail(
      state,
      `${target.name} に ${branch} がありません。`,
      `先に git push ${target.name} ${branch} を実行してください。`,
    );
  }

  const header = [
    `git fetch ${target.name} と git merge ${tracking} を続けて実行します。`,
    `${target.name} から ${fetched.added} 件のコミットを取ってきました。`,
  ];

  // ここから先は merge そのもの。fast-forward にも 3-way にもなる
  const merged = merge(fetched.state, {
    raw: `git merge ${tracking}`,
    name: 'merge',
    isGit: true,
    flags: {},
    positional: [tracking],
  });

  if (merged.error) {
    // fetch までは終わっているので、その結果は残す
    return {
      state: fetched.state,
      log: [...header, merged.error, ...merged.log.slice(1)],
      error: merged.error,
      touched: ['repo'],
    };
  }

  const withTracked: RepoState = {
    ...merged.state,
    tracked: recomputeTracked(merged.state, findBranch(merged.state, branch)?.target ?? null),
  };

  return ok(withTracked, [...header, ...merged.log], ['repo', 'head']);
}
