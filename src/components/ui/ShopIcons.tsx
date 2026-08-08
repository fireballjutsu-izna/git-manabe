/**
 * 3 領域を、店の道具に見立てた小さな印。
 *
 * 見出しは git の言葉のまま（「ステージ（index）」を「バケツ」に置き換えない）。
 * 覚えてほしいのは git の語彙で、店の言い方はその手がかりにすぎない。
 * だから絵も、意味を運ぶのではなく**見分けを助けるだけ**の大きさに留める。
 */

const BASE = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** 作業台 ＝ 作業ディレクトリ。切った枝を広げておく台。 */
export function Workbench() {
  return (
    <svg {...BASE}>
      <path d="M3 10h18" />
      <path d="M5 10v9M19 10v9" />
      <path d="M8 10V7l4-2 4 2v3" />
    </svg>
  );
}

/** バケツ ＝ ステージ。出す花を選んで挿しておくところ。 */
export function Bucket() {
  return (
    <svg {...BASE}>
      <path d="M5 8h14l-1.4 11.2a1 1 0 0 1-1 .8H7.4a1 1 0 0 1-1-.8z" />
      <path d="M4 8h16" />
      <path d="M9 8V5.5M15 8V5.5" />
    </svg>
  );
}

/** 店頭 ＝ リポジトリ。お客さんの目に触れる、確定したもの。 */
export function Storefront() {
  return (
    <svg {...BASE}>
      <path d="M4 9h16v10H4z" />
      <path d="M3 9l1.6-4h14.8L21 9" />
      <path d="M10 19v-5h4v5" />
    </svg>
  );
}
