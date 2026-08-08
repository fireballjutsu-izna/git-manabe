import createMDX from '@next/mdx';
import rehypePrettyCode from 'rehype-pretty-code';
import remarkGfm from 'remark-gfm';
import githubDarkDimmed from 'shiki/themes/github-dark-dimmed.mjs';
import githubLightHighContrast from 'shiki/themes/github-light-high-contrast.mjs';

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

/*
 * コメントの色だけ、既定より濃く（ライト）／明るく（ダーク）差し替える。
 *
 * どの配色もコメントを「目立たせない色」として置くが、この記事では
 * コメントに説明そのものが書いてある（# 作業ディレクトリ → ステージ）。
 * 読ませる文なので、本文と同じ 7:1 まで上げる。
 * 素の github-light-high-contrast は、このサイトのコード背景 (#EEEEF5) では
 * 4.36:1 しか出ず、AA にも届かない。
 */
// 差し替えは元の文字列そのままの一致で効く。大文字小文字は配色ごとに違うので、
// 元の値をここに書き写しておく（配色を変えたら、ここも見直すこと）。
const recolor = (theme, from, to) => ({
  ...theme,
  colorReplacements: { ...theme.colorReplacements, [from]: to },
});

/** @type {import('rehype-pretty-code').Options} */
const prettyCodeOptions = {
  // ダーク既定・ライト切り替えの 2 テーマを同時に焼き込む。
  // 出力される CSS 変数を globals.css 側で data-theme に応じて切り替える。
  theme: {
    dark: recolor(githubDarkDimmed, '#768390', '#96a2ae'),
    light: recolor(githubLightHighContrast, '#66707b', '#464c53'),
  },
  keepBackground: false,
  defaultLang: 'bash',
};

const withMDX = createMDX({
  options: {
    // 表・打ち消し線・自動リンクは GFM の拡張なので、素の MDX では解釈されない。
    // これが無いと記事の表が「| 見出し | ... |」のまま本文に出る。
    remarkPlugins: [remarkGfm],
    rehypePlugins: [[rehypePrettyCode, prettyCodeOptions]],
  },
});

export default withMDX(nextConfig);
