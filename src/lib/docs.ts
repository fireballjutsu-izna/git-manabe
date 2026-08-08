/**
 * 記事の目次。
 *
 * カリキュラムの 1 項目 = 記事 1 本 = レベル 1 つ、で揃えてある。
 * レベル（手を動かす）と記事（読んで確かめる）が同じ id を共有するので、
 * どちらからでも相手へ行き来できる。
 */

export interface Doc {
  /** レベルの id と同じ。URL にもなる。 */
  id: string;
  title: string;
  /** 一覧に出す 1 行。 */
  summary: string;
}

export const DOCS: Doc[] = [
  {
    id: 'areas',
    title: '3 つの領域',
    summary: 'add と commit が何を運んでいるのか。Git が値を持つ場所は 3 つしかない',
  },
  {
    id: 'ignore',
    title: '.gitignore ― 出してしまった秘密',
    summary:
      '.gitignore は「まだ追跡していないもの」にしか効かない。コミット済みのものは git rm --cached まで止まらず、外しても履歴には残る',
  },
  {
    id: 'branch',
    title: '枝と HEAD',
    summary: 'ブランチは「コミットに付けた名前」でしかない。動く仕組みは付箋 2 枚で説明できる',
  },
  {
    id: 'detached',
    title: 'detached HEAD',
    summary: '事故ではなく 1 つのモード。ここでのコミットが行方不明になる理由',
  },
  {
    id: 'fast-forward',
    title: 'fast-forward マージ',
    summary: 'マージしたのにマージコミットができない。分かれていないなら合流点は要らない',
  },
  {
    id: 'three-way',
    title: '3-way マージ',
    summary: '親を 2 つ持つコミット。分岐点を見つけて、両側をそこから 1 つに戻す',
  },
  {
    id: 'conflict',
    title: 'コンフリクト',
    summary: '止まるだけで、壊れない。出口は「決着をつける」と「やめる」の 2 つだけ',
  },
  {
    id: 'reset-modes',
    title: 'reset の 3 つのモード',
    summary: '枝はどのモードでも同じだけ動く。違うのは、取り消した中身をどこまで戻すか',
  },
  {
    id: 'revert',
    title: 'revert ― 消さずに打ち消す',
    summary: '履歴を書き換えずに取り消す唯一の方法。共有済みの履歴に使えるのはこちら',
  },
  {
    id: 'stash',
    title: 'stash ― 脇へどける',
    summary: 'コミットを 1 つも作らずに、作業を片付ける。グラフに跡が残らない唯一のコマンド',
  },
  {
    id: 'cherry-pick',
    title: 'cherry-pick ― 1 つだけ摘む',
    summary: 'コミットを 1 つコピーする。同じ中身が 2 か所にある状態になる',
  },
  {
    id: 'rebase',
    title: 'rebase ― 土台を置き直す',
    summary: 'merge との違いは 1 点。こちらは作り直すので、id が変わる',
  },
  {
    id: 'interactive',
    title: '対話的 rebase ― まとめる・落とす・並べ替える',
    summary:
      '置き直す前に計画を書き換えられる rebase。squash でまとめ、drop で落とす。押した瞬間には、まだ何も起きていない',
  },
  {
    id: 'reflog',
    title: 'reflog ― やらかしから戻る',
    summary: '失くしたコミットへの最後の道。HEAD が通ってきた道は全部残っている',
  },
  {
    id: 'remote',
    title: 'リモート ― fetch と pull',
    summary: '向こうのコミットは、fetch するまでこちらに存在しない。見えないのではなく、無い',
  },
];

export const findDoc = (id: string): Doc | undefined => DOCS.find((d) => d.id === id);
export const docIndex = (id: string): number => DOCS.findIndex((d) => d.id === id);
