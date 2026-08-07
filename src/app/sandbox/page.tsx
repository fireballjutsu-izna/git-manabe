import type { Metadata } from 'next';
import { Sandbox } from '@/components/sandbox/Sandbox';

export const metadata: Metadata = {
  title: 'サンドボックス',
  description:
    'git コマンドを打つと、コミットグラフがその場で動きます。作業ディレクトリ・ステージ・リポジトリのどこが書き換わったかも同時に光ります。',
};

export default function SandboxPage() {
  return <Sandbox />;
}
