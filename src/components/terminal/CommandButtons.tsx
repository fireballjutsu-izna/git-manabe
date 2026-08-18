'use client';

import { useState } from 'react';

import {
  currentBranchName,
  headCommitId,
  ignorePatterns,
  isAncestor,
  matchesIgnore,
  pausingWays,
  reachableCommits,
  type RepoState,
} from '@/lib/git-engine';
import { useRepoStore } from '@/store/repo';

interface Suggestion {
  label: string;
  line: string;
  hint?: string;
  /**
   * now … いまの状態から見て、押して意味があるもの
   * more … 打てはするが出番の無いもの。既定で畳む
   *
   * 全部並べていたら 12 個になり、肝心のものが埋もれていた。
   * とくに reset --hard が常に見えているのは危うい ―
   * シナリオの途中で押すと、そこまでの手順が消える。
   */
  tier: 'now' | 'more';
  /**
   * now のなかでの優先順。小さいほど前に出る。
   *
   * 枝が増えると now だけで 8 個 9 個になるので、上から 6 個で切る。
   * どれを切るかを積んだ順まかせにすると、
   * 「いちばん押してほしいもの」が落ちることがあるので、明示する。
   */
  weight: number;
}

/** 見出しの行に並べる上限。これを超えた now は、畳むほうへ回す。 */
const NOW_LIMIT = 6;

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

/** まだ使っていない v1.0, v1.1, …。同じ名前のタグは付けられないので、ずらす。 */
function nextTag(state: RepoState): string {
  for (let n = 0; ; n += 1) {
    const name = `v1.${n}`;
    if (!state.tags.some((t) => t.name === name) && !state.branches.some((b) => b.name === name)) {
      return name;
    }
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
  const [showAll, setShowAll] = useState(false);

  const head = headCommitId(state);
  const branch = currentBranchName(state);

  const suggestions: Suggestion[] = [];
  /** いま押して意味があるもの。weight を省くと真ん中の順。 */
  const now = (s: Omit<Suggestion, 'tier' | 'weight'> & { weight?: number }): void => {
    suggestions.push({ weight: 2, ...s, tier: 'now' });
  };
  /**
   * 打てはするが、いまの状況では出番の無いもの。畳んでおく。
   *
   * weight は受け取るが使わない。同じ 1 か所で now と more を切り替える
   * 書き方（`(条件 ? now : more)({...})`）があるので、形を揃えておく。
   */
  const more = (s: Omit<Suggestion, 'tier' | 'weight'> & { weight?: number }): void => {
    suggestions.push({ ...s, tier: 'more', weight: 9 });
  };

  if (!state.initialized) {
    now({ label: 'git init', line: 'git init', hint: 'ここから始まります' });
  } else if (state.todo) {
    /*
     * 計画を立てている最中。組み立ては上のパネルでやるほうが早いので、
     * ここには「実行」と「やめる」と、見るだけのものだけを出す。
     */
    now({ label: 'todo run', line: 'todo run', hint: '計画を実行する', weight: 0 });
    now({ label: 'todo list', line: 'todo list', hint: 'いまの計画を見る', weight: 1 });
    now({ label: 'git rebase --abort', line: 'git rebase --abort', hint: 'やめる', weight: 2 });
    now({ label: 'git log --oneline', line: 'git log --oneline', weight: 3 });
  } else if (state.pausing) {
    /*
     * 止まっている間は、通るコマンドだけを出す。
     * 押しても断られるボタンが並んでいると、詰まった人がさらに迷う。
     *
     * 続け方は merge / rebase / cherry-pick で違うので、
     * いま止まっているものに合わせたボタンだけを出す。
     */
    const ways = pausingWays(state.pausing.kind);

    // 片側を選ぶ → add、の順に並べる。目印を手で消すより、これがいちばん早い
    for (const c of state.pausing.conflicts) {
      now({
        label: `git checkout --ours ${c.path}`,
        line: `git checkout --ours ${c.path}`,
        hint: 'こちら側を残す',
        weight: 0,
      });
      now({
        label: `git checkout --theirs ${c.path}`,
        line: `git checkout --theirs ${c.path}`,
        hint: '向こう側を残す',
        weight: 0,
      });
      now({
        label: `git add ${c.path}`,
        line: `git add ${c.path}`,
        hint: '決着をつけた印',
        weight: 1,
      });
    }
    if (state.pausing.conflicts.length === 0) {
      now({ label: ways.next, line: ways.next, hint: '先へ進める', weight: 0 });
    }
    now({ label: ways.abort, line: ways.abort, hint: '始める前に戻す', weight: 2 });
    now({ label: 'git status', line: 'git status', weight: 3 });
    now({ label: 'git diff', line: 'git diff', hint: 'ぶつかった中身を見る', weight: 3 });
    for (const c of state.pausing.conflicts) {
      more({ label: `cat ${c.path}`, line: `cat ${c.path}`, hint: '目印ごと中身を読む' });
    }
    more({ label: 'git log', line: 'git log' });
  } else if (state.bisect) {
    /*
     * 二分探索の最中。ここで打つことは 3 つしかない ―
     * 中身を見る、good か bad を答える、やめる。
     * 木を伸ばすボタンをここに並べても、押す先が detached HEAD なので邪魔にしかならない。
     */
    const b = state.bisect;

    if (b.culprit) {
      now({
        label: 'git bisect reset',
        line: 'git bisect reset',
        hint: '始める前の枝へ戻る',
        weight: 0,
      });
      now({ label: 'git log --oneline', line: 'git log --oneline', weight: 1 });
    } else if (b.testing) {
      // 判定するには中身を読まないといけない。読む手段をいちばん前に置く
      for (const path of Object.keys(state.work).sort().slice(0, 2)) {
        now({ label: `cat ${path}`, line: `cat ${path}`, hint: '中身を見る', weight: 0 });
      }
      now({ label: 'git bisect good', line: 'git bisect good', hint: 'ここは動く', weight: 1 });
      now({ label: 'git bisect bad', line: 'git bisect bad', hint: 'ここは壊れている', weight: 1 });
      now({ label: 'git bisect reset', line: 'git bisect reset', hint: 'やめる', weight: 4 });
      more({ label: 'git bisect skip', line: 'git bisect skip', hint: '判定できない版' });
      more({ label: 'git bisect log', line: 'git bisect log', hint: 'これまでの判定' });
    } else {
      // まだ範囲が決まっていない。足りないほうだけを出す
      if (!b.bad) {
        now({
          label: 'git bisect bad',
          line: 'git bisect bad',
          hint: 'いまここは壊れている',
          weight: 0,
        });
      } else {
        const oldest = Object.values(state.commits).sort((x, y) => x.createdAt - y.createdAt)[0];
        if (oldest) {
          now({
            label: `git bisect good ${oldest.id}`,
            line: `git bisect good ${oldest.id}`,
            hint: 'ここは動いていた',
            weight: 0,
          });
        }
      }
      now({ label: 'git log --oneline', line: 'git log --oneline', hint: 'id を確かめる', weight: 1 });
      now({ label: 'git bisect reset', line: 'git bisect reset', hint: 'やめる', weight: 3 });
    }
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
    now({ label: `touch ${file}`, line: `touch ${file}`, hint: '変更を 1 つ作る', weight: 1 });

    if (state.workingDir.length > 0) {
      now({ label: 'git add .', line: 'git add .', hint: 'ステージへ移す', weight: 0 });
    }

    // ステージが空のときは「木を伸ばす」より先にやることがあるので、畳んでおく
    (state.index.length > 0 ? now : more)({
      label: 'git commit',
      line: `git commit -m "${state.index.length > 0 ? 'ステージの変更' : 'コミット'}${
        Object.keys(state.commits).length + 1
      }"`,
      hint: '木を 1 つ伸ばす',
      weight: 0,
    });

    if (head) {
      const wanted = suggest?.branch;
      const name =
        wanted && !state.branches.some((b) => b.name === wanted) ? wanted : nextBranch(state);
      // 課題が名前を指定しているなら、それは「いま押すもの」
      (suggest?.branch === name ? now : more)({
        label: `git branch ${name}`,
        line: `git branch ${name}`,
        hint: 'いまのコミットに名前を付ける',
        weight: 1,
      });

      for (const b of state.branches) {
        if (b.name === branch) continue;
        now({ label: `git switch ${b.name}`, line: `git switch ${b.name}`, weight: 3 });
      }

      // 取り込むものが残っている枝だけをマージ候補に出す。
      // すでに祖先になっている枝を出すと「押しても何も起きない」ボタンになる。
      if (branch) {
        for (const b of state.branches) {
          if (b.name === branch) continue;
          if (isAncestor(state, b.target, head)) continue;
          now({
            label: `git merge ${b.name}`,
            line: `git merge ${b.name}`,
            hint: isAncestor(state, head, b.target) ? 'fast-forward' : '2 親のコミットができる',
            weight: 2,
          });
        }
      }

      if (state.commits[head].parents.length > 0) {
        more({
          label: 'git reset --soft HEAD~1',
          line: 'git reset --soft HEAD~1',
          hint: '中身はステージに残る',
        });
        more({
          label: 'git reset --mixed HEAD~1',
          line: 'git reset --mixed HEAD~1',
          hint: '中身は未ステージに落ちる',
        });
        more({
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
          more({
            label: `git rebase ${b.name}`,
            line: `git rebase ${b.name}`,
            hint: 'コピーし直す（id が変わる）',
          });
          more({
            label: `git rebase -i ${b.name}`,
            line: `git rebase -i ${b.name}`,
            hint: 'まとめる・落とす・並べ替える',
          });
        }
      }

      more({
        label: 'git revert HEAD',
        line: 'git revert HEAD',
        hint: '打ち消すコミットを足す',
      });

      if (state.workingDir.length > 0 || state.index.length > 0) {
        now({ label: 'git stash', line: 'git stash', hint: '脇へどける', weight: 3 });
      }
      if (state.stash.length > 0) {
        now({ label: 'git stash pop', line: 'git stash pop', hint: '戻す', weight: 1 });
      }

      if (state.reflog.length > 0) {
        more({ label: 'git reflog', line: 'git reflog', hint: 'HEAD が通った道' });
      }

      // どこからも辿れなくなったコミットがあるなら、拾い方をそのまま出す。
      // 「戻せる」と書くより、押せるボタンがあるほうが早い。
      const reachable = reachableCommits(state);
      const lostId = Object.keys(state.commits).find((id) => !reachable.has(id));
      if (lostId) {
        now({
          label: `git switch -c 救出 ${lostId}`,
          line: `git switch -c 救出 ${lostId}`,
          hint: '辿れないコミットを拾う',
          weight: 0,
        });
      }

      // リモート。登録 → push → 同僚が進める → fetch/pull、の順に出す
      if (state.remotes.length === 0) {
        more({
          label: 'git remote add origin <url>',
          line: 'git remote add origin https://example.com/repo.git',
          hint: 'リモートを登録する',
        });
      } else if (branch) {
        const remoteName = state.remotes[0].name;
        const theirs = state.remotes[0].branches.find((b) => b.name === branch);
        const known = state.remoteBranches.find((t) => t.name === `${remoteName}/${branch}`);

        /*
         * 向こうの先端がこちらから辿れない ＝ 自分で書き換えたあと。
         * ここで普通の push を出しても必ず断られるので、押し出すほうを出す。
         */
        const rewritten =
          theirs !== undefined && !isAncestor(state, theirs.target, head) && known?.target === theirs.target;

        if (rewritten) {
          now({
            label: `git push --force-with-lease ${remoteName} ${branch}`,
            line: `git push --force-with-lease ${remoteName} ${branch}`,
            hint: '書き換えたぶんを押し出す',
            weight: 0,
          });
          more({
            label: `git push ${remoteName} ${branch}`,
            line: `git push ${remoteName} ${branch}`,
            hint: 'そのままだと断られる',
          });
        } else if (!theirs) {
          now({
            label: `git push ${remoteName} ${branch}`,
            line: `git push ${remoteName} ${branch}`,
            hint: '向こうへ送る',
            weight: 1,
          });
        } else {
          now({ label: 'teammate 1', line: 'teammate 1', hint: '同僚が 1 つ進める', weight: 3 });
          if (known?.target !== theirs.target) {
            now({
              label: `git fetch ${remoteName}`,
              line: `git fetch ${remoteName}`,
              hint: '取ってくるだけ',
              weight: 1,
            });
            now({
              label: `git pull ${remoteName} ${branch}`,
              line: `git pull ${remoteName} ${branch}`,
              hint: '取ってきて取り込む',
              weight: 1,
            });
          } else if (known.target !== head) {
            now({
              label: `git push ${remoteName} ${branch}`,
              line: `git push ${remoteName} ${branch}`,
              hint: '向こうへ送る',
              weight: 1,
            });
          }
        }
      }

      if (state.head.type === 'detached' && state.branches.length > 0) {
        now({
          label: `git switch ${state.branches[0].name}`,
          line: `git switch ${state.branches[0].name}`,
          hint: '枝に戻る',
          weight: 0,
        });
      }
    }

    /*
     * 無視されているファイルがあるなら、その扱い方を出す。
     * .gitignore は「書いたのに効かない」で詰まる場所なので、
     * 追跡から外すボタンをその場に置いておく。
     */
    /*
     * .gitignore に書いてあるのに、まだ追跡しているファイル。
     *
     * isIgnored はステージに載っているものを false にする（それが本物の規則）ので、
     * ここは「パターンに当たるか」だけを直に見る ― まさにこの食い違いが、
     * 「書いたのに効かない」の正体なので、ボタンで出口を出しておく。
     */
    const patterns = ignorePatterns(state);
    const trackedSecret = Object.keys(state.stage)
      .sort()
      .find((path) => matchesIgnore(path, patterns));
    for (const f of state.workingDir) {
      if (f.status !== 'ignored') continue;
      more({
        label: `git add -f ${f.path}`,
        line: `git add -f ${f.path}`,
        hint: '無視を押し切って入れる',
      });
    }
    if (trackedSecret) {
      now({
        label: `git rm --cached ${trackedSecret}`,
        line: `git rm --cached ${trackedSecret}`,
        hint: '追跡から外す',
        weight: 0,
      });
    }
    if (!used(state, '.gitignore')) {
      more({
        label: 'touch .gitignore',
        line: 'touch .gitignore',
        hint: '見せないものを決める',
      });
    } else if (state.work['.gitignore']) {
      more({
        label: 'append .gitignore <パターン>',
        line: 'append .gitignore .env',
        hint: '無視するものを 1 行足す',
      });
    }

    now({ label: 'git status', line: 'git status', weight: 4 });
    if (state.workingDir.length > 0) {
      now({ label: 'git diff', line: 'git diff', hint: 'まだ add していない行', weight: 2 });
    }
    if (state.index.length > 0) {
      more({ label: 'git diff --staged', line: 'git diff --staged', hint: 'add したぶんの行' });
    }
    more({ label: 'git log --oneline', line: 'git log --oneline', hint: '1 行ずつ短く' });
    if (Object.keys(state.commits).length > 1) {
      more({
        label: 'git log --graph',
        line: 'git log --graph --all',
        hint: 'ターミナルにも枝の形を出す',
      });
    }
    more({ label: 'git log --all', line: 'git log --all', hint: '辿れないものも出す' });
    // 探すものが無いと意味が出ないので、履歴がある程度たまってから出す
    if (Object.keys(state.commits).length >= 4) {
      more({
        label: 'git bisect start',
        line: 'git bisect start',
        hint: 'いつ壊れたかを半分ずつ探す',
      });
    }
    if (head) {
      more({
        label: `git tag ${nextTag(state)}`,
        line: `git tag ${nextTag(state)}`,
        hint: '動かない目印を付ける',
      });
    }
    if (state.tags.length > 0) {
      more({ label: 'git tag', line: 'git tag', hint: 'タグの一覧' });
    }
  }

  /*
   * now を weight 順に並べ、上から 6 個までを表に出す。
   * 溢れた分は捨てずに「ほかのコマンド」へ回す ― 押せなくなるわけではない。
   * sort は安定なので、同じ weight どうしは積んだ順のまま。
   */
  const ranked = suggestions.filter((s) => s.tier === 'now').sort((a, b) => a.weight - b.weight);
  const primary = ranked.slice(0, NOW_LIMIT);
  const rest = [...ranked.slice(NOW_LIMIT), ...suggestions.filter((s) => s.tier === 'more')];

  const Button = ({ s }: { s: Suggestion }) => (
    <button
      type="button"
      onClick={() => runLine(s.line)}
      title={s.hint ? `${s.line} — ${s.hint}` : s.line}
      className="rounded border border-line bg-elev px-2.5 py-1.5 text-left font-mono text-xs text-fg hover:border-cyan-neon hover:bg-tint-cyan"
    >
      {s.label}
      {s.hint && <span className="ml-2 font-sans text-[10px] text-muted">{s.hint}</span>}
    </button>
  );

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2" data-buttons="now">
        {primary.map((s) => (
          <Button key={s.label} s={s} />
        ))}

        {rest.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            aria-controls="more-commands"
            data-more-toggle=""
            className="rounded border border-dashed border-line px-2.5 py-1.5 text-xs text-muted hover:border-line-lit hover:text-fg"
          >
            {showAll ? 'ほかのコマンドを閉じる' : `ほかのコマンド（${rest.length}）`}
          </button>
        )}
      </div>

      {showAll && rest.length > 0 && (
        <div
          id="more-commands"
          data-buttons="more"
          className="flex flex-wrap gap-2 rounded-card border border-line bg-inset px-3 py-2.5"
        >
          {rest.map((s) => (
            <Button key={s.label} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}
