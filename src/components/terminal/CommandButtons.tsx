'use client';

import {
  currentBranchName,
  headCommitId,
  isAncestor,
  reachableCommits,
  type RepoState,
} from '@/lib/git-engine';
import { useRepoStore } from '@/store/repo';

/** そのパスが、もう作業ディレクトリかステージか履歴のどこかにあるか。 */
function used(state: RepoState, path: string): boolean {
  return (
    state.tracked.includes(path) ||
    state.workingDir.some((f) => f.path === path) ||
    state.index.some((f) => f.path === path)
  );
}

/** まだ使っていない file-N.txt。 */
function nextFile(state: RepoState): string {
  for (let n = 1; ; n += 1) {
    const path = `file-${n}.txt`;
    if (!used(state, path)) return path;
  }
}

/** まだ使っていない feature-X。押すたびに次の名前へ進む。 */
function nextBranch(state: RepoState): string {
  for (let i = 0; i < 26; i += 1) {
    const name = `feature-${String.fromCharCode(97 + i)}`;
    if (!state.branches.some((b) => b.name === name)) return name;
  }
  return `feature-${state.branches.length}`;
}

/**
 * ボタンから同じコマンドを打てるようにする。
 *
 * 狭い画面では xterm への打ち込みが現実的でないのと、
 * 「次に何を打てばいいか分からない」で止まる人がいちばん多いため、
 * いまの状態から意味のある候補だけを出す。
 */
export function CommandButtons({ suggest }: { suggest?: { file?: string; branch?: string } }) {
  const state = useRepoStore((s) => s.history.present);
  const runLine = useRepoStore((s) => s.runLine);

  const head = headCommitId(state);
  const branch = currentBranchName(state);

  const suggestions: { label: string; line: string; hint?: string }[] = [];

  if (!state.initialized) {
    suggestions.push({ label: 'git init', line: 'git init', hint: 'ここから始まります' });
  } else if (state.merging) {
    /*
     * マージが止まっている間は、通るコマンドだけを出す。
     * 押しても断られるボタンが並んでいると、詰まった人がさらに迷う。
     */
    for (const path of state.merging.conflicts) {
      suggestions.push({
        label: `git add ${path}`,
        line: `git add ${path}`,
        hint: '決着をつけた印',
      });
    }
    if (state.merging.conflicts.length === 0) {
      suggestions.push({ label: 'git commit', line: 'git commit', hint: 'マージを完了する' });
    }
    suggestions.push({
      label: 'git merge --abort',
      line: 'git merge --abort',
      hint: '始める前に戻す',
    });
    suggestions.push({ label: 'git status', line: 'git status' });
    suggestions.push({ label: 'git log', line: 'git log' });
  } else {
    /*
     * 課題が名前を指定しているなら、それを出す。
     * 「hello.txt を作り」と書いてあるのにボタンが file-1.txt を出すと、
     * 押しても課題が終わらない。
     *
     * 指定が無いときは、まだ使っていない file-N を選ぶ。
     * 個数から採番すると、file-1 も file-2 も無いのに file-3 が出ることがある。
     */
    const file = suggest?.file && !used(state, suggest.file) ? suggest.file : nextFile(state);
    suggestions.push({ label: `touch ${file}`, line: `touch ${file}`, hint: '変更を 1 つ作る' });

    if (state.workingDir.length > 0) {
      suggestions.push({ label: 'git add .', line: 'git add .', hint: 'ステージへ移す' });
    }

    suggestions.push({
      label: 'git commit',
      line: `git commit -m "${state.index.length > 0 ? 'ステージの変更' : 'コミット'}${
        Object.keys(state.commits).length + 1
      }"`,
      hint: '木を 1 つ伸ばす',
    });

    if (head) {
      const wanted = suggest?.branch;
      const name =
        wanted && !state.branches.some((b) => b.name === wanted) ? wanted : nextBranch(state);
      suggestions.push({
        label: `git branch ${name}`,
        line: `git branch ${name}`,
        hint: 'いまのコミットに名前を付ける',
      });

      for (const b of state.branches) {
        if (b.name === branch) continue;
        suggestions.push({ label: `git switch ${b.name}`, line: `git switch ${b.name}` });
      }

      // 取り込むものが残っている枝だけをマージ候補に出す。
      // すでに祖先になっている枝を出すと「押しても何も起きない」ボタンになる。
      if (branch) {
        for (const b of state.branches) {
          if (b.name === branch) continue;
          if (isAncestor(state, b.target, head)) continue;
          suggestions.push({
            label: `git merge ${b.name}`,
            line: `git merge ${b.name}`,
            hint: isAncestor(state, head, b.target) ? 'fast-forward' : '2 親のコミットができる',
          });
        }
      }

      if (state.commits[head].parents.length > 0) {
        suggestions.push({
          label: 'git reset --soft HEAD~1',
          line: 'git reset --soft HEAD~1',
          hint: '中身はステージに残る',
        });
        suggestions.push({
          label: 'git reset --mixed HEAD~1',
          line: 'git reset --mixed HEAD~1',
          hint: '中身は未ステージに落ちる',
        });
        suggestions.push({
          label: 'git reset --hard HEAD~1',
          line: 'git reset --hard HEAD~1',
          hint: '中身は消える',
        });
      }

      // rebase は「分かれている枝の上」でしか意味がない
      if (branch) {
        for (const b of state.branches) {
          if (b.name === branch) continue;
          if (isAncestor(state, b.target, head)) continue;
          suggestions.push({
            label: `git rebase ${b.name}`,
            line: `git rebase ${b.name}`,
            hint: 'コピーし直す（id が変わる）',
          });
        }
      }

      suggestions.push({
        label: 'git revert HEAD',
        line: 'git revert HEAD',
        hint: '打ち消すコミットを足す',
      });

      if (state.workingDir.length > 0 || state.index.length > 0) {
        suggestions.push({ label: 'git stash', line: 'git stash', hint: '脇へどける' });
      }
      if (state.stash.length > 0) {
        suggestions.push({ label: 'git stash pop', line: 'git stash pop', hint: '戻す' });
      }

      if (state.reflog.length > 0) {
        suggestions.push({ label: 'git reflog', line: 'git reflog', hint: 'HEAD が通った道' });
      }

      // どこからも辿れなくなったコミットがあるなら、拾い方をそのまま出す。
      // 「戻せる」と書くより、押せるボタンがあるほうが早い。
      const reachable = reachableCommits(state);
      const lostId = Object.keys(state.commits).find((id) => !reachable.has(id));
      if (lostId) {
        suggestions.push({
          label: `git switch -c 救出 ${lostId}`,
          line: `git switch -c 救出 ${lostId}`,
          hint: '辿れないコミットを拾う',
        });
      }

      // リモート。登録 → push → 同僚が進める → fetch/pull、の順に出す
      if (state.remotes.length === 0) {
        suggestions.push({
          label: 'git remote add origin <url>',
          line: 'git remote add origin https://example.com/repo.git',
          hint: 'リモートを登録する',
        });
      } else if (branch) {
        const remoteName = state.remotes[0].name;
        const theirs = state.remotes[0].branches.find((b) => b.name === branch);
        const known = state.remoteBranches.find((t) => t.name === `${remoteName}/${branch}`);

        if (!theirs) {
          suggestions.push({
            label: `git push ${remoteName} ${branch}`,
            line: `git push ${remoteName} ${branch}`,
            hint: '向こうへ送る',
          });
        } else {
          suggestions.push({ label: 'teammate 1', line: 'teammate 1', hint: '同僚が 1 つ進める' });
          if (known?.target !== theirs.target) {
            suggestions.push({
              label: `git fetch ${remoteName}`,
              line: `git fetch ${remoteName}`,
              hint: '取ってくるだけ',
            });
            suggestions.push({
              label: `git pull ${remoteName} ${branch}`,
              line: `git pull ${remoteName} ${branch}`,
              hint: '取ってきて取り込む',
            });
          } else if (known.target !== head) {
            suggestions.push({
              label: `git push ${remoteName} ${branch}`,
              line: `git push ${remoteName} ${branch}`,
              hint: '向こうへ送る',
            });
          }
        }
      }

      if (state.head.type === 'detached' && state.branches.length > 0) {
        suggestions.push({
          label: `git switch ${state.branches[0].name}`,
          line: `git switch ${state.branches[0].name}`,
          hint: '枝に戻る',
        });
      }
    }

    suggestions.push({ label: 'git status', line: 'git status' });
    suggestions.push({ label: 'git log', line: 'git log' });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => runLine(s.line)}
          title={s.hint ? `${s.line} — ${s.hint}` : s.line}
          className="rounded border border-line bg-elev px-2.5 py-1.5 text-left font-mono text-xs text-fg hover:border-cyan-neon hover:bg-tint-cyan"
        >
          {s.label}
          {s.hint && <span className="ml-2 font-sans text-[10px] text-muted">{s.hint}</span>}
        </button>
      ))}
    </div>
  );
}
