# こえだ

**動かして学ぶ Git** — git のコマンドを打つと、コミットの木が目の前で育つ日本語の学習サイトです。

Git は `add` と `commit` までは覚えられますが、その先でブランチ・HEAD・rebase・reset の壁にぶつかります。
その壁の正体は、ほとんどが「いま何がどこを指しているのか」が見えないことです。
このサイトは、コマンドを 1 つ打つたびに

- コミットの木（DAG）がどう伸びたか
- ブランチと HEAD がどこへ移ったか
- 作業ディレクトリ・ステージ・リポジトリの**どの領域が書き換わったか**

を図で見せます。読むより先に触れるように作ってあります。

## 本物の Git ではありません

このサイトの Git は**教育用に簡略化したモデル**で、本物の Git を動かしているわけではありません。
コミット・ブランチ・HEAD・ステージをプレーンなデータとして持ち、
各コマンドを「状態 → 新しい状態」を返す純粋関数として実装しています。

そうしている理由は 1 つで、**いちばん図で見たい操作ほど、ブラウザで動く本物の Git が苦手**だからです。
純 JavaScript 実装の isomorphic-git は rebase・interactive rebase・revert・reflog を実装しておらず、
コンフリクトの起きる merge も `MergeNotSupportedError` で中断します。
つまり、このサイトが見せたいものがそっくり欠けます。
Learn Git Branching と Explain Git with D3 が疑似 Git を選んでいるのも同じ理由です。

正確な仕様は [git-scm 公式ドキュメント](https://git-scm.com/doc)を参照してください。

## いま触れるもの

| コマンド | できること |
| --- | --- |
| `git init` | リポジトリを作る。まだコミットが 1 つも無い状態（unborn HEAD）から始まる |
| `git add <path>` / `git add .` | 作業ディレクトリの変更を、ステージへ移す |
| `git commit -m <msg>` | ステージの中身を 1 つのコミットにして、木を伸ばす |
| `git branch [name]` / `-d` | 枝の一覧・作成・削除。HEAD は動かない |
| `git checkout` / `git switch` | HEAD を別の枝へ移す。コミットを直接指すと detached HEAD になる |
| `git status` / `git log` | いまの 3 領域と、コミットの履歴を見る |
| `touch <path>` / `edit <path>` | **Git のコマンドではありません。**作業ディレクトリに変更を作るための、このサイト独自のコマンドです |

merge・reset の 3 モード・rebase・cherry-pick・revert・stash・reflog・リモート・コンフリクト解決は、これから追加していきます。

## 開発

```bash
npm install
npm run dev        # http://localhost:3000/git-manabe/
```

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバ |
| `npm run build` | 静的書き出し（`out/`） |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest（シミュレータのコアを重点的に） |

### 構成

```
src/
├─ app/                Next.js App Router のページ
│  ├─ (docs)/          MDX の解説記事
│  └─ sandbox/         コマンドを打って木を育てる本体
├─ components/
│  ├─ graph/           SVG のコミットグラフと 3 領域パネル
│  ├─ terminal/        ターミナル UI
│  └─ ui/              共通の部品
└─ lib/
   └─ git-engine/      シミュレータのコア（React にも DOM にも依存しない）
```

`src/lib/git-engine/` は UI から完全に独立させ、全て純粋関数で書いています。
`react` も `next` も DOM API も import しません。そのぶん Vitest で単体テストできます。

### 技術スタック

Next.js 15（App Router・静的書き出し）/ React 19 / TypeScript / Tailwind CSS 4 /
Motion（旧 Framer Motion）/ Zustand / xterm.js / MDX + Shiki（rehype-pretty-code）/ Vitest。

## 姉妹サイト

[(アイン、ソフ、オウル) — Three.js のための数学](https://github.com/fireballjutsu-izna/webgl_manabe)

## ライセンス

MIT
