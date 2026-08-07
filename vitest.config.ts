import { defineConfig } from 'vitest/config';

/**
 * テストの対象はシミュレータのコア（src/lib/git-engine）。
 * ここは React にも DOM にも依存しない純粋関数なので、環境は node のままでよい。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': new URL('./src/', import.meta.url).pathname },
  },
});
