'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { TodoItem } from '@/lib/git-engine';
import { useRepoStore } from '@/store/repo';

/**
 * 対話的 rebase（`git rebase -i`）の計画パネル。
 *
 * 本物はエディタでテキストを書き換える:
 *
 *   pick   a1b2c3d  ラッピングを直した
 *   squash e4f5g6h  typo
 *   drop   i7j8k9l  デバッグ用のログ
 *
 * ブラウザにはエディタが無いので、同じ表を並べてボタンで組み立てる。
 * **押すと todo コマンドが打たれる**ようにしてあるのが要点で、
 * 打った内容はターミナルに残り、1 手戻すも効く ―
 * パネルだけが state を直に触ると、この 2 つが壊れる。
 */
const ACTIONS: { key: TodoItem['action']; label: string; note: string; tone: string }[] = [
  { key: 'pick', label: 'pick', note: 'そのまま積む', tone: 'text-branch border-branch' },
  { key: 'squash', label: 'squash', note: '1 つ上にまとめる', tone: 'text-head border-head' },
  { key: 'reword', label: 'reword', note: 'メッセージを変える', tone: 'text-tag border-tag' },
  { key: 'drop', label: 'drop', note: '落とす', tone: 'text-detached border-detached' },
];

export function TodoPane() {
  const todo = useRepoStore((s) => s.history.present.todo);
  const runLine = useRepoStore((s) => s.runLine);
  const reduce = useReducedMotion();

  if (!todo) return null;

  const kept = todo.items.filter((i) => i.action !== 'drop').length;

  return (
    <section
      data-pane="todo"
      className="rounded-card border border-head bg-tint-amber px-3 py-3 text-xs"
      aria-live="polite"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-head">書き換えの計画を立てています</h3>
        <code className="font-mono text-[11px] text-muted">
          {todo.upstream} の上へ / {kept} 件になります
        </code>
      </header>
      <p className="mt-1 leading-relaxed text-muted">
        本物の <code className="font-mono text-fg">git rebase -i</code> は、この表をエディタで開きます。
        <strong className="text-fg">まだ履歴は何も変わっていません。</strong>
        並べ替えて「実行」を押すと、そこから始まります。
      </p>

      <ol className="mt-2.5 grid gap-1.5">
        <AnimatePresence initial={false}>
          {todo.items.map((item, i) => (
            <motion.li
              key={item.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: item.action === 'drop' ? 0.45 : 1 }}
              exit={{ opacity: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.18 }}
              data-todo={item.id}
              data-todo-action={item.action}
              className="grid gap-1.5 rounded border border-line bg-elev px-2 py-1.5 sm:grid-cols-[auto_1fr_auto] sm:items-center"
            >
              {/* 並べ替え。上が古い ― 本物の todo ファイルと同じ向き */}
              <div className="flex items-center gap-1">
                <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => runLine(`todo up ${i + 1}`)}
                  disabled={i === 0}
                  aria-label={`${i + 1} 行目を上へ`}
                  className="rounded border border-line px-1 leading-none text-muted disabled:opacity-30 hover:enabled:border-cyan-neon hover:enabled:text-fg"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => runLine(`todo down ${i + 1}`)}
                  disabled={i === todo.items.length - 1}
                  aria-label={`${i + 1} 行目を下へ`}
                  className="rounded border border-line px-1 leading-none text-muted disabled:opacity-30 hover:enabled:border-cyan-neon hover:enabled:text-fg"
                >
                  ↓
                </button>
              </div>

              <div className="min-w-0">
                <code className="font-mono text-[11px] text-muted">{item.id}</code>{' '}
                <span className="text-fg">{item.message}</span>
                {item.message !== item.original && (
                  <span className="ml-1 text-[10px] text-muted">（元: {item.original}）</span>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {ACTIONS.map((a) => {
                  const chosen = item.action === a.key;
                  // 1 行目に squash は付けられない（上にまとめる相手がいない）
                  const disabled = a.key === 'squash' && i === 0;
                  return (
                    <button
                      key={a.key}
                      type="button"
                      disabled={disabled}
                      aria-pressed={chosen}
                      title={a.note}
                      onClick={() =>
                        runLine(
                          a.key === 'reword'
                            ? `todo reword ${i + 1} ${item.original}（直しました）`
                            : `todo ${a.key} ${i + 1}`,
                        )
                      }
                      className={[
                        'rounded border px-1.5 py-0.5 font-mono text-[10px] disabled:opacity-25',
                        chosen ? `${a.tone} font-bold` : 'border-line text-muted',
                      ].join(' ')}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-todo-run=""
          onClick={() => runLine('todo run')}
          className="rounded border border-head bg-elev px-3 py-1.5 font-bold text-head hover:bg-tint-amber"
        >
          実行する
        </button>
        <button
          type="button"
          onClick={() => runLine('git rebase --abort')}
          className="rounded border border-line px-3 py-1.5 text-muted hover:border-rose-neon hover:text-fg"
        >
          やめる
        </button>
        <span className="text-[11px] text-muted">
          ボタンは <code className="font-mono">todo</code> コマンドを打っています。ターミナルにも残ります。
        </span>
      </div>
    </section>
  );
}
