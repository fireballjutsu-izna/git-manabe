import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // next-env.d.ts と out/ は Next.js の生成物なので検査しない。
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'artifacts/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // 未使用の変数は型検査（noUnusedLocals）側でも見る。
      // ここでは「意図的に捨てる」書き方だけ許す。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
