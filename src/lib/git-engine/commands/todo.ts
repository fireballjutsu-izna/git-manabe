import { replayTodo } from '../interactive';
import type { ParsedCommand } from '../parse';
import { fail, headCommitId, ok, requireRepo } from '../state';
import type { CommandResult, RepoState, Todo, TodoItem } from '../types';

/**
 * `todo …` — Git のコマンドではない。
 *
 * 本物の `git rebase -i` は、こういうテキストをエディタで開く:
 *
 *   pick   a1b2c3d  ラッピングを直した
 *   squash e4f5g6h  typo
 *   drop   i7j8k9l  デバッグ用のログ
 *
 * 行を書き換えたり並べ替えたりして、**エディタを閉じると始まる**。
 * ブラウザにはエディタが無いので、同じことをこのコマンドとパネルでやる。
 * touch や edit と同じで、Git には無い補助コマンド。
 *
 *   todo list            いまの計画を見る
 *   todo pick <n>        n 行目をそのまま積む
 *   todo squash <n>      n 行目を、1 つ上にまとめる
 *   todo reword <n> <文> n 行目のメッセージを書き換える
 *   todo drop <n>        n 行目を落とす
 *   todo up <n> / down <n>   並べ替える
 *   todo run             実行する（本物ならエディタを閉じるところ）
 */
export function todo(state: RepoState, command: ParsedCommand): CommandResult {
  const blocked = requireRepo(state);
  if (blocked) return blocked;

  const plan = state.todo;
  if (!plan) {
    return fail(
      state,
      'いま書き換えの計画を立てているところではありません。',
      'git rebase -i <枝> で始まります。',
    );
  }

  const sub = command.positional[0] ?? 'list';
  if (sub === 'list') return list(state, plan);
  if (sub === 'run') return run(state, plan);

  const n = Number(command.positional[1]);
  if (!Number.isInteger(n) || n < 1 || n > plan.items.length) {
    return fail(
      state,
      `${command.positional[1] ?? ''} という行はありません。`,
      `1 〜 ${plan.items.length} で指定してください（todo list で番号が見られます）。`,
    );
  }
  const i = n - 1;

  switch (sub) {
    case 'pick':
    case 'squash':
    case 'reword':
    case 'drop':
      return setAction(state, plan, i, sub, command.positional.slice(2).join(' ').trim());
    case 'up':
      return swap(state, plan, i, i - 1);
    case 'down':
      return swap(state, plan, i, i + 1);
    default:
      return fail(
        state,
        `todo ${sub} は扱えません。`,
        '使えるのは list / pick / squash / reword / drop / up / down / run です。',
      );
  }
}

/** 計画を書き換えたあとの、共通の返し方。 */
function updated(state: RepoState, plan: Todo, items: TodoItem[], lines: string[]): CommandResult {
  const next = { ...state, todo: { ...plan, items } };
  return ok(next, [...lines, '', ...planLines(items)], ['repo']);
}

function planLines(items: TodoItem[]): string[] {
  return [
    '計画:',
    ...items.map((item, i) => {
      const changed = item.message !== item.original ? `  ← 「${item.original}」から` : '';
      return `  ${i + 1}  ${item.action.padEnd(6)} ${item.id}  ${item.message}${changed}`;
    }),
    '',
    '並べ替えたら todo run で実行します（本物ならエディタを閉じるところです）。',
  ];
}

function list(state: RepoState, plan: Todo): CommandResult {
  return ok(state, [`${plan.upstream} の上へ書き換えて置き直します。`, ...planLines(plan.items)], []);
}

function setAction(
  state: RepoState,
  plan: Todo,
  i: number,
  action: TodoItem['action'],
  text: string,
): CommandResult {
  /*
   * squash は「1 つ上にまとめる」なので、1 行目には付けられない。
   * 本物の git も、todo の 1 行目が squash だと実行を断る。
   */
  if (action === 'squash' && i === 0) {
    return fail(
      state,
      '1 行目は squash にできません。',
      'squash は「1 つ上のコミットにまとめる」という指定なので、上が要ります。',
    );
  }
  if (action === 'reword' && !text) {
    return fail(state, '書き換えるメッセージを書いてください。', `例: todo reword ${i + 1} 新しいメッセージ`);
  }

  const items = plan.items.map((item, index) => {
    if (index !== i) return item;
    return {
      ...item,
      action,
      message: action === 'reword' ? text : item.original,
    };
  });

  const label: Record<TodoItem['action'], string> = {
    pick: 'そのまま積みます',
    squash: '1 つ上にまとめます',
    reword: 'メッセージを書き換えます',
    drop: '落とします',
  };

  return updated(state, plan, items, [`${i + 1} 行目を ${action} にしました ― ${label[action]}。`]);
}

function swap(state: RepoState, plan: Todo, from: number, to: number): CommandResult {
  if (to < 0 || to >= plan.items.length) {
    return fail(state, 'これ以上は動かせません。');
  }

  const items = [...plan.items];
  [items[from], items[to]] = [items[to], items[from]];

  // 動かした結果、1 行目が squash になってしまうと実行できない
  if (items[0].action === 'squash') {
    return fail(
      state,
      '1 行目が squash になってしまいます。',
      'squash は「1 つ上にまとめる」ので、上が要ります。先に pick へ戻してください。',
    );
  }

  return updated(state, plan, items, [`${from + 1} 行目を ${to + 1} 行目へ動かしました。`]);
}

/**
 * `todo run` ― 計画を実行する。
 *
 * ここまで履歴には何も起きていない。押した瞬間から、素の rebase と同じことが始まる。
 */
function run(state: RepoState, plan: Todo): CommandResult {
  if (plan.items.every((item) => item.action === 'drop')) {
    return fail(
      state,
      '全部 drop にすると、置き直すものが無くなります。',
      '1 つは残してください。やめるなら git rebase --abort です。',
    );
  }

  const from = headCommitId(state) as string;
  // 積む先へ移ってから、1 つずつ当てる（素の rebase と同じ手順）
  const branch = state.head.type === 'branch' ? state.head.ref : null;
  const moved: RepoState = branch
    ? {
        ...state,
        todo: null,
        branches: state.branches.map((b) => (b.name === branch ? { ...b, target: plan.onto } : b)),
      }
    : { ...state, todo: null, head: { type: 'detached', oid: plan.onto } };

  return replayTodo(moved, {
    items: plan.items,
    messages: [],
    done: [],
    from,
    upstream: plan.upstream,
    saved: plan.saved,
  });
}
