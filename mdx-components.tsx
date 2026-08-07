import type { MDXComponents } from 'mdx/types';

/**
 * MDX 記事の中の素の HTML 要素に、サイト共通の見た目を与える。
 * 記事側は Tailwind のクラスを書かずに、素直な Markdown だけで済むようにする。
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: (props) => <h1 className="mb-3 text-2xl font-bold text-fg" {...props} />,
    h2: (props) => (
      <h2 className="mt-10 mb-3 border-b border-line pb-2 text-xl font-bold text-fg" {...props} />
    ),
    h3: (props) => <h3 className="mt-8 mb-2 text-lg font-bold text-fg" {...props} />,
    p: (props) => <p className="my-4 leading-loose" {...props} />,
    ul: (props) => <ul className="my-4 list-disc space-y-1 pl-6" {...props} />,
    ol: (props) => <ol className="my-4 list-decimal space-y-1 pl-6" {...props} />,
    a: (props) => (
      <a className="text-cyan-neon underline underline-offset-2" {...props} />
    ),
    strong: (props) => <strong className="font-bold text-fg" {...props} />,
    table: (props) => (
      <div className="my-6 overflow-x-auto">
        <table className="w-full border-collapse text-sm" {...props} />
      </div>
    ),
    th: (props) => (
      <th
        className="border border-line bg-inset px-3 py-2 text-left font-bold text-fg"
        {...props}
      />
    ),
    td: (props) => <td className="border border-line px-3 py-2 align-top" {...props} />,
    // インラインの `コード`。ブロックの pre は globals.css 側で整えている。
    code: (props) =>
      'data-language' in props ? (
        <code {...props} />
      ) : (
        <code
          className="rounded border border-line bg-inset px-1.5 py-0.5 font-mono text-[0.85em]"
          {...props}
        />
      ),
    ...components,
  };
}
