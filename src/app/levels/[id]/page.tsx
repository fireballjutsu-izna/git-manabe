import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LevelRunner } from '@/components/level/LevelRunner';
import { findLevel, LEVELS } from '@/lib/levels';

/** 静的書き出しなので、どのレベルのページを作るかを先に伝える。 */
export function generateStaticParams() {
  return LEVELS.map((level) => ({ id: level.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const level = findLevel((await params).id);
  if (!level) return { title: 'レベル' };
  return { title: level.title, description: level.intro };
}

export default async function LevelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!findLevel(id)) notFound();
  // Level そのものではなく id を渡す。check が関数なので境界を越えられない
  return <LevelRunner levelId={id} />;
}
