import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ScenarioRunner } from '@/components/scenario/ScenarioRunner';
import { findScenario, SCENARIOS } from '@/lib/scenarios';
import { pageMetadata } from '@/lib/seo';

/** 静的書き出しなので、どのシナリオのページを作るかを先に伝える。 */
export function generateStaticParams() {
  return SCENARIOS.map((s) => ({ id: s.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const scenario = findScenario((await params).id);
  if (!scenario) return { title: 'シナリオ' };
  return pageMetadata({
    title: scenario.title,
    description: `${scenario.subtitle}。${scenario.intro}`,
    path: `/scenarios/${scenario.id}/`,
  });
}

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!findScenario(id)) notFound();
  // Scenario そのものではなく id を渡す。check が関数なので境界を越えられない
  return <ScenarioRunner scenarioId={id} />;
}
