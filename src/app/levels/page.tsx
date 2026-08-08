import type { Metadata } from 'next';
import { LevelList } from '@/components/level/LevelList';

export const metadata: Metadata = {
  title: 'レベル',
  description:
    '3 領域から始めて、ブランチ・detached HEAD・merge・reset・rebase・reflog・リモートまで、1 つずつ課題を解きながら進みます。',
};

export default function LevelsPage() {
  return <LevelList />;
}
