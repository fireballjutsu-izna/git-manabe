import { Sandbox } from '@/components/sandbox/Sandbox';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'サンドボックス',
  description:
    'git コマンドを打つと、コミットグラフがその場で動きます。作業ディレクトリ・ステージ・リポジトリのどこが書き換わったかも同時に光ります。',
  path: '/sandbox/',
});

export default function SandboxPage() {
  return <Sandbox />;
}
