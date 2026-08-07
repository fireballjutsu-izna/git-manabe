/** 記事ページの共通の器。行長を読みやすい幅に絞る。 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <article className="mx-auto max-w-2xl">{children}</article>;
}
