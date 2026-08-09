import { ScenarioList } from '@/components/scenario/ScenarioList';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'シナリオ',
  description:
    'こえだ花店での 1 日として、実務でよくある場面を一続きに解きます。割り込みのホットフィックス、レビュー対応、push が断られたとき、main への直コミット、コンフリクト、出してしまった秘密ファイル、force push での出し直し、リリース準備。',
  path: '/scenarios/',
});

export default function ScenariosPage() {
  return <ScenarioList />;
}
