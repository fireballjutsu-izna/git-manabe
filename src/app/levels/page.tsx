import { LevelList } from '@/components/level/LevelList';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'レベル',
  description:
    '3 領域から始めて、.gitignore・ブランチ・detached HEAD・merge・コンフリクト・reset・rebase・対話的 rebase・reflog・リモートまで、1 つずつ課題を解きながら進みます。',
  path: '/levels/',
});

export default function LevelsPage() {
  return <LevelList />;
}
