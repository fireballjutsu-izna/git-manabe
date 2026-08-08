'use client';

import dynamic from 'next/dynamic';
import { CommandInput } from './CommandInput';
import { OutputAnnouncer } from './OutputAnnouncer';

/**
 * xterm.js は window と document を前提にしているので、
 * サーバでは読み込まない。静的書き出し（output: 'export'）でも、
 * ここを ssr:false にしておけばビルドが通る。
 */
const TerminalView = dynamic(() => import('./TerminalView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-48 w-full items-center justify-center rounded-card border border-line bg-sunken text-sm text-muted sm:h-72">
      ターミナルを読み込んでいます…
    </div>
  ),
});

export function Terminal() {
  return (
    <>
      <TerminalView />
      <CommandInput />
      <OutputAnnouncer />
    </>
  );
}
