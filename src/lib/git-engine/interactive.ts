import { copyTree, mergeTrees } from './content';
import {
  addCommit,
  currentBranchName,
  headCommitId,
  loadTree,
  nextCommitId,
  ok,
  recomputeTracked,
  recordReflog,
  setBranch,
  setHead,
  treeOf,
} from './state';
import { pauseWith } from './apply';
import type { CommandResult, Pausing, RepoState, TodoItem, Tree } from './types';

/*
 * 対話的 rebase の実行。
 *
 * 素の rebase が「並んでいるものを、そのまま 1 つずつ当て直す」なのに対し、
 * こちらは**当てる前に計画を書き換えられる**。それだけの違いだが、
 * squash（前のものにまとめる）が入るので、当てる単位が 1 コミットではなくなる。
 *
 * ループの持ち物:
 *   parent          いまの先端
 *   pendingTree     まとめ途中の塊の中身（何も開いていなければ null）
 *   pendingMessage  その塊のメッセージ（squash のぶんだけ増える）
 *   items           残りの todo
 *
 * ぶつかって止まっても、この 4 つがあれば同じ場所から再開できる。
 * 止まる／続けるは素の rebase と同じ Pausing に相乗りする ―
 * 学習者から見て、止まり方が 2 種類あっては覚えることが増えるだけなので。
 */

/** squash でまとめたメッセージを 1 つにする。 */
export function joinMessages(messages: string[]): string {
  return messages.length === 1 ? messages[0] : messages.join(' + ');
}

/** 枝の上なら枝ごと、detached なら HEAD だけを動かす。 */
function moveTo(state: RepoState, id: string): RepoState {
  const branch = currentBranchName(state);
  return branch ? setBranch(state, branch, id) : setHead(state, { type: 'detached', oid: id });
}

export interface ReplayInput {
  items: TodoItem[];
  messages: string[];
  /** 直前に作ったコミット（表示用）。 */
  done: { before: string; after: string }[];
  /** reflog に残す出発点。 */
  from: string;
  upstream: string;
  saved: Pausing['saved'];
  /** 途中で止まって再開したときの、決着済みの中身。 */
  resumedTree?: Tree;
  /** まとめ途中の塊の先頭コミット。再開時に引き継ぐ。 */
  leadId?: string;
  /** 止まっていて、いま決着がついた 1 件。再開のときだけ入る。 */
  justApplied?: TodoItem;
}

/**
 * 残りの todo を当てていく。
 *
 * 呼ばれるのは 2 か所だけ ― todo run と git rebase --continue。
 * どちらも「残りを当てる」だけなので、入口はここ 1 つで足りる。
 */
export function replayTodo(state: RepoState, input: ReplayInput): CommandResult {
  let next = state;
  let parent = currentTip(next);
  const items = [...input.items];
  const done = [...input.done];
  const dropped: TodoItem[] = [];

  /* まとめ途中の塊。何も開いていなければ tree が null。 */
  let pendingTree: Tree | null = null;
  let messages: string[] = [...input.messages];
  let groupLead: string | null = input.leadId ?? null;
  let groupAuthor = 'あなた';

  /**
   * 開いている塊を 1 つのコミットにして閉じる。
   *
   * 「次が squash かどうか」でしか呼ばないので、
   * squash が続く限り塊は開いたまま ― これが -i の squash そのもの。
   */
  const closeGroup = (): void => {
    if (pendingTree === null || groupLead === null) return;
    const id = nextCommitId(next);
    next = addCommit(next, {
      id,
      parents: [parent],
      message: joinMessages(messages),
      author: groupAuthor,
      tree: pendingTree,
    });
    done.push({ before: groupLead, after: id });
    parent = id;
    next = moveTo(next, parent);
    pendingTree = null;
    messages = [];
    groupLead = null;
  };

  /*
   * 止まっていたぶんを引き取って再開する場合。
   *
   * 決着をつけた中身（ステージ）が、そのまま塊の中身になる。
   * そのうえで、素の 1 周と同じ「次が squash か」の判定を通す ―
   * ここを飛ばすと、続きが全部同じ塊にまとまってしまう。
   */
  if (input.justApplied) {
    pendingTree = copyTree(input.resumedTree ?? {});
    messages = [...input.messages, input.justApplied.message];
    groupLead = input.leadId ?? input.justApplied.id;
    groupAuthor = next.commits[input.justApplied.id]?.author ?? 'あなた';
    if (items[0]?.action !== 'squash') closeGroup();
  }

  while (items.length > 0) {
    const item = items[0];

    if (item.action === 'drop') {
      dropped.push(item);
      items.shift();
      continue;
    }

    const original = next.commits[item.id];
    const ours = pendingTree ?? treeOf(next, parent);
    const merged = mergeTrees(
      treeOf(next, original.parents[0] ?? null),
      ours,
      original.tree,
      '積む先',
      item.original,
    );

    if (merged.conflicts.length > 0) {
      return pauseWith(
        next,
        {
          kind: 'rebase',
          from: item.original,
          theirs: item.id,
          base: original.parents[0] ?? null,
          conflicts: merged.conflicts,
          saved: input.saved,
          remaining: items.map((i) => i.id),
          done,
          // 決着がついたら、この続きから再開する
          todo: { items, messages, leadId: groupLead ?? undefined },
        },
        merged.tree,
      );
    }

    pendingTree = merged.tree;
    messages.push(item.message);
    if (groupLead === null) {
      groupLead = item.id;
      groupAuthor = original.author;
    }
    items.shift();

    // 次が squash なら塊は開いたまま。そうでなければここで 1 つ作る
    if (items[0]?.action !== 'squash') closeGroup();
  }

  next = loadTree(next, treeOf(next, parent));
  next = { ...next, tracked: recomputeTracked(next, parent), pausing: null, todo: null };
  next = recordReflog(next, 'rebase -i', `${input.upstream} の上へ書き換えて置き直す`, input.from, parent);

  const lines = [
    `${done.length} 件のコミットに書き換えて、${input.upstream} の上へ置き直しました。`,
    ...done.map((p) => `  ${p.before} → ${p.after}  ${next.commits[p.after].message}`),
  ];
  if (dropped.length > 0) {
    lines.push(`落としたもの: ${dropped.map((d) => `${d.id}（${d.original}）`).join(', ')}`);
    lines.push('落としたコミットも消えてはいません。どの枝からも辿れなくなっただけです。');
  }
  lines.push('id はすべて変わっています。中身が同じでも、別のコミットとして作り直されたからです。');

  return ok(next, lines, ['repo', 'head', 'workingDir', 'index']);
}

function currentTip(state: RepoState): string {
  return headCommitId(state) as string;
}
