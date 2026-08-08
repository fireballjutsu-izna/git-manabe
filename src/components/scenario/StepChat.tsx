'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ScenarioStep } from '@/lib/scenarios';

/**
 * 依頼が届くところ。
 *
 * レベルでは「やること」を 1 枠で出しているが、シナリオは話が進むので、
 * **これまでのやりとりを残したまま**下へ積む。
 * 前に何を頼まれたのかを見返せないと、途中から何の話か分からなくなる。
 */
export function StepChat({
  steps,
  /** いま取り組んでいるステップの番号（0 始まり）。 */
  current,
}: {
  steps: ScenarioStep[];
  current: number;
}) {
  const reduce = useReducedMotion();
  // 済んだぶんと、いま取り組んでいるぶんだけ出す。先の依頼は見せない
  const shown = steps.slice(0, Math.min(current + 1, steps.length));

  return (
    <div
      className="grid gap-3"
      // 届いた依頼は、画面を見ていない人にも伝わってほしい
      aria-live="polite"
      data-testid="chat"
    >
      <AnimatePresence initial={false}>
        {shown.map((step, i) => {
          const done = i < current;
          return (
            <motion.div
              key={i}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: done ? 0.55 : 1, y: 0 }}
              transition={{ duration: 0.25 }}
              data-step={i}
              data-done={done ? 'true' : undefined}
              className="rounded-card border border-line bg-elev px-4 py-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold text-accent">{step.from}</span>
                <span className="font-mono text-[11px] text-muted">
                  {i + 1} / {steps.length}
                </span>
              </div>

              <p className="mt-1.5 text-sm leading-relaxed">{step.message}</p>

              {/*
                比喩が勝ちすぎて手が止まることがあるので、
                git として何をするのかは必ず素で添える。
              */}
              <p className="mt-2 border-t border-line pt-2 text-sm">
                <span className="font-bold text-fg">やること: </span>
                <span className="text-muted">{step.task}</span>
              </p>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
