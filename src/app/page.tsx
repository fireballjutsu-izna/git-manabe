import Link from 'next/link';
import { SITE } from '@/lib/site';

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold tracking-wide text-accent">{SITE.name}</h1>
      <p className="mt-1 text-sm text-muted">{SITE.tagline}</p>

      <p className="mt-8 leading-loose">
        git のコマンドを打つと、<strong className="text-fg">コミットの木が目の前で育ちます</strong>。
        ブランチが枝分かれし、HEAD が枝から枝へ移り、
        add した変更がステージへ、commit した変更がリポジトリへ移っていく様子を、
        図で見ながら覚えるサイトです。
      </p>

      <p className="mt-4 leading-loose text-muted">
        本を読んで分かった気になるのがいちばん危ないところなので、
        説明より先に<strong className="text-fg">まず触れる</strong>ようにしてあります。
        壊しても本物のリポジトリには何も起きません。
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/levels"
          className="inline-block rounded-card border border-line-lit bg-tint-cyan px-5 py-2.5 font-bold text-fg no-underline hover:border-cyan-neon"
        >
          レベルを始める →
        </Link>
        <Link
          href="/sandbox"
          className="inline-block rounded-card border border-line px-5 py-2.5 text-muted no-underline hover:border-line-lit hover:text-fg"
        >
          自由に触る（サンドボックス）
        </Link>
      </div>
      <p className="mt-3 text-xs text-muted">
        レベルは 13 個。1 つにつき概念 1 つで、状況はこちらで用意します。
        クリアの記録と連続日数は、この端末の中だけに残ります。
      </p>

      <section className="mt-14">
        <h2 className="border-b border-line pb-2 text-lg font-bold text-accent">いま触れるもの</h2>
        <ul className="mt-4 space-y-3">
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git init
            </code>
            <span className="text-sm">リポジトリを作る。まだコミットが 1 つも無い状態から始まる</span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git add
            </code>
            <span className="text-sm">作業ディレクトリの変更を、ステージへ移す</span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git commit
            </code>
            <span className="text-sm">ステージの中身を 1 つのコミットにして、木を伸ばす</span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git branch
            </code>
            <span className="text-sm">枝の名前を、いまのコミットに付ける</span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git switch
            </code>
            <span className="text-sm">
              HEAD を別の枝へ移す。コミットを直接指すと detached HEAD になる
            </span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git merge
            </code>
            <span className="text-sm">
              分かれた枝を 1 つに戻す。分岐していなければ fast-forward
              で、コミットは増えない
            </span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git reset
            </code>
            <span className="text-sm">
              枝を巻き戻す。<code className="font-mono">--soft</code> /{' '}
              <code className="font-mono">--mixed</code> /{' '}
              <code className="font-mono">--hard</code> で、どの領域まで巻き添えにするかが変わる
            </span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git rebase
            </code>
            <span className="text-sm">
              枝ごと別の土台の上へコピーし直す。中身は同じでも id が変わる
            </span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git revert
            </code>
            <span className="text-sm">
              打ち消すコミットを新しく積む。reset と違い、履歴は 1 つも消えない
            </span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git stash
            </code>
            <span className="text-sm">
              コミットせずに作業を脇へどける。唯一、グラフが変わらないコマンド
            </span>
          </li>
          <li className="flex gap-3">
            <code className="mt-0.5 shrink-0 rounded border border-line bg-inset px-1.5 font-mono text-xs text-muted">
              git reflog
            </code>
            <span className="text-sm">
              HEAD が通ってきた道の記録。reset --hard でやらかしても、ここから戻れる
            </span>
          </li>
        </ul>
        <p className="mt-5 text-sm text-muted">
          cherry-pick・リモート（push / fetch / pull）・コンフリクトの解決も使えます。
        </p>
      </section>
    </div>
  );
}
