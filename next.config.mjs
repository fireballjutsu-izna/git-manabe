import createMDX from '@next/mdx';
import rehypePrettyCode from 'rehype-pretty-code';

/**
 * GitHub Pages では https://fireballjutsu-izna.github.io/git-manabe/ に配信されるため、
 * basePath を固定する。dev サーバも同じ base で動く（http://localhost:3000/git-manabe/）。
 * サーバを持たないサイトなので output: 'export' で静的書き出しにする。
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/git-manabe',
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  // experimental.mdxRs は有効にしない。
  // Rust 版の MDX コンパイラは rehype プラグインを通さないため、
  // 有効にすると下の rehype-pretty-code（Shiki ハイライト）が丸ごと効かなくなる。
};

/** @type {import('rehype-pretty-code').Options} */
const prettyCodeOptions = {
  // ダーク既定・ライト切り替えの 2 テーマを同時に焼き込む。
  // 出力される CSS 変数を globals.css 側で data-theme に応じて切り替える。
  theme: { dark: 'github-dark-dimmed', light: 'github-light' },
  keepBackground: false,
  defaultLang: 'bash',
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [],
    rehypePlugins: [[rehypePrettyCode, prettyCodeOptions]],
  },
});

export default withMDX(nextConfig);
