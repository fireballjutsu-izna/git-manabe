import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS } from '@/lib/docs';
import { LEVELS } from '@/lib/levels';
import { SCENARIOS } from '@/lib/scenarios';
import { GIT_COMMANDS, HELPER_COMMANDS, PLANNED_COMMANDS } from '@/lib/git-engine';

/**
 * 記事が実装から取り残されていないかを見る。
 *
 * 記事はコードと違って、古くなっても誰も気づかない。
 * 実際にあったのは、コマンドを実装したあとも「扱っていません」と書き続けていたことと、
 * 図の 1 行が消えたまま出ていたこと。どちらもテストも smoke も見ていなかった。
 *
 * 機械で拾えるのはここまで、という線も引いておく。
 * 「中身は持ちません」のように、文の意味が実装とずれているものは読んで直すしかない。
 * だから**言い切りの形**（「扱っていません」）と**桁**だけを見る。
 */

const DOCS_DIR = join(process.cwd(), 'src/app/(docs)');
const ENGINE_DIR = join(process.cwd(), 'src/lib/git-engine');

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, ext));
    else if (name.endsWith(ext)) out.push(path);
  }
  return out;
}

const pages = walk(DOCS_DIR, '.mdx').map((file) => ({
  where: relative(process.cwd(), file),
  text: readFileSync(file, 'utf8'),
}));

/**
 * そのコマンドを実装しているファイルの中身。見つからなければ null。
 *
 * サブコマンド（git bisect run の run）まで見るときに使う。
 * エンジン全体を引くと、別のコマンドの同名サブコマンド（todo run）に当たってしまう。
 */
function sourceOf(name: string): string | null {
  const path = join(ENGINE_DIR, 'commands', `${name}.ts`);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** エンジンのソース全部。フラグが実装済みかは、ここを引いて確かめる。 */
const engineSource = walk(ENGINE_DIR, '.ts')
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

const KNOWN = new Set<string>([...GIT_COMMANDS, ...HELPER_COMMANDS]);
const PLANNED = new Set<string>(PLANNED_COMMANDS);

/** 記事の中の ``` の塊。 */
function blocks(text: string): { lang: string; body: string }[] {
  return [...text.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], body: m[2] }));
}

/**
 * 1 行からコマンド名を取り出す。打てない行（コメント・出力・プレースホルダ）は null。
 *
 * 引数までは見ない。`git merge feature` の feature が実在するかは状況次第で、
 * そこまで見ようとすると、記事の例をぜんぶ実行できる状態にしないといけなくなる。
 */
function commandName(line: string): string | null {
  const text = line.replace(/#.*$/, '').trim();
  if (!text) return null;

  const tokens = text.split(/\s+/);
  const head = tokens[0];

  if (head === 'git') {
    const sub = tokens[1];
    // git だけ、あるいは git <プレースホルダ> は例として成立している
    if (!sub || sub.startsWith('<') || sub.startsWith('-')) return null;
    return sub;
  }
  if ((HELPER_COMMANDS as readonly string[]).includes(head)) return head;
  return null;
}

/**
 * 未実装だと言っている言い回し。
 * 「本物にはあるが、ここには無い」と断ってある例は、そのまま載せてよい。
 */
const DISCLAIMERS = /扱っていません|入っていません|実装していません|対応していません|踏み込んでいません/;

/** その一連の行に出てくるコマンド名のうち、打てないもの。 */
function unusable(lines: string[]): string[] {
  const bad: string[] = [];
  for (const line of lines) {
    const name = commandName(line);
    if (name === null) continue;
    if (PLANNED.has(name)) bad.push(`${name}（まだ実装していません）`);
    else if (!KNOWN.has(name)) bad.push(`${name}（そんなコマンドはありません）`);
  }
  return bad;
}

/**
 * その記事が、そのフラグを「ここには無い」と断っているか。
 *
 * 本物の Git の書き方を紹介するために、実装していないフラグを載せることがある
 * （`git merge --no-ff` など）。断ってあれば読者が打って詰まることはないので、通す。
 */
function disclaimed(text: string, flag: string): boolean {
  return text
    .split('\n')
    .some((line) => DISCLAIMERS.test(line) && line.includes(`\`${flag}\``));
}

/** 例に出てくるフラグのうち、実装されておらず、断りもないもの。 */
function undocumentedFlags(text: string): string[] {
  const bad: string[] = [];
  const lines = blocks(text)
    .filter((b) => b.lang === 'bash')
    .flatMap((b) => b.body.split('\n'));

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line.startsWith('git ')) continue;

    for (const [, flag] of line.matchAll(/(?<![\w-])(--?[a-zA-Z][\w-]*)/g)) {
      // hasFlag に渡すときの書き方（クオート付き）で引く
      if (engineSource.includes(`'${flag}'`)) continue;
      if (disclaimed(text, flag)) continue;
      bad.push(`${flag}（${line}）`);
    }
  }
  return bad;
}

describe('記事に出てくるコマンドは、実際に打てる', () => {
  it.each(pages.map((p) => [p.where, p] as const))('%s', (_, page) => {
    const lines = blocks(page.text)
      .filter((b) => b.lang === 'bash')
      .flatMap((b) => b.body.split('\n'));
    expect(unusable(lines)).toEqual([]);
  });

  it.each(pages.map((p) => [p.where, p] as const))('%s のフラグ', (_, page) => {
    expect(undocumentedFlags(page.text)).toEqual([]);
  });

  it('記事が 1 つも読めていない、ということはない', () => {
    expect(pages.length).toBeGreaterThan(10);
  });
});

describe('ヒントに出てくるコマンドも、実際に打てる', () => {
  it.each(LEVELS.map((l) => [l.id, l] as const))('レベル %s', (_, level) => {
    expect(unusable([...level.hints, level.task])).toEqual([]);
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))('シナリオ %s', (_, scenario) => {
    const lines = scenario.steps.flatMap((step) => [...step.hints, step.task, step.message]);
    expect(unusable(lines)).toEqual([]);
  });
});

/**
 * 「扱っていません」と書いたものが、あとから実装されていないか。
 *
 * この向きの陳腐化は、読んでも気づきにくい ―
 * 記事の中では筋が通ったままなので、実装を知っていないと違和感が出ない。
 */
describe('「扱っていません」が嘘になっていない', () => {
  /** その行が「未実装だ」と言っているコマンドやフラグのうち、実は実装済みのもの。 */
  function brokenClaims(line: string): string[] {
    if (!DISCLAIMERS.test(line)) return [];
    const found: string[] = [];

    for (const [, span] of line.matchAll(/`([^`]+)`/g)) {
      const token = span.trim();

      /*
       * サブコマンドまで書いてあるなら、そこまで見る。
       *
       * git bisect は入っているが git bisect run は入っていない ―
       * コマンド名だけで判定すると、正しい断り書きを「嘘だ」と言ってしまう。
       * そのコマンドを実装しているファイルを引いて、
       * サブコマンドの文字列がその中にあるかどうかで決める。
       */
      const asCommand = token.match(/^git\s+([a-z-]+)(?:\s+([a-z][\w-]*))?/);
      if (asCommand && KNOWN.has(asCommand[1])) {
        const own = sourceOf(asCommand[1]);
        const sub = asCommand[2];
        if (!sub || !own || own.includes(`'${sub}'`)) found.push(token);
        continue;
      }

      /*
       * フラグは、エンジンのソースにその文字列が出てくるかで見る。
       * 短い形（-i）は他の語に紛れるので、'-i' のようにクオートで囲まれた形だけを探す
       * ― hasFlag に渡すときの書き方に合わせている。
       */
      if (/^-{1,2}[a-z][a-z-]*$/.test(token) && engineSource.includes(`'${token}'`)) {
        found.push(token);
      }
    }
    return found;
  }

  it.each(pages.map((p) => [p.where, p] as const))('%s', (_, page) => {
    const broken = page.text.split('\n').flatMap(brokenClaims);
    expect(broken).toEqual([]);
  });

  it('言い切りの形を、そもそも拾えている', () => {
    // 検査そのものが空振りしていないことの確認。1 つも無ければ正規表現が壊れている
    const withDisclaimer = pages.filter((p) => DISCLAIMERS.test(p.text));
    expect(withDisclaimer.length).toBeGreaterThan(0);
  });
});

/**
 * git log --graph を写した図の桁。
 *
 * 1 レーンは 2 文字ぶんなので、* と | は必ず偶数桁、斜線はその 1 つ手前に来る。
 * ここが崩れるのは行が 1 本まるごと落ちたときで、実際に `|\` が消えて
 * `|*` になったまま出ていたことがある。
 */
describe('グラフの図の桁が崩れていない', () => {
  function looksLikeGraphArt(body: string): boolean {
    const lines = body.split('\n').filter((l) => l.trim().length > 0);
    const artish = lines.filter((l) => /^[*|\\/ ]{2,}/.test(l) && /[*|]/.test(l));
    return artish.length >= 2 && lines.some((l) => l.trimStart().startsWith('*'));
  }

  function misplaced(body: string): string[] {
    const bad: string[] = [];
    for (const line of body.split('\n')) {
      const art = line.match(/^[*|\\/ ]+/)?.[0] ?? '';
      if (!art.trim()) continue;

      for (let i = 0; i < art.length; i += 1) {
        const ch = art[i];
        if ((ch === '*' || ch === '|') && i % 2 !== 0) {
          bad.push(`${line}（${ch} が ${i} 桁目）`);
          break;
        }
        if ((ch === '\\' || ch === '/') && i % 2 === 0) {
          bad.push(`${line}（${ch} が ${i} 桁目）`);
          break;
        }
      }

      // 斜線の行にコミットの印は来ない。混ざっていたら、行が 1 本落ちている
      if (/[\\/]/.test(art) && art.includes('*')) {
        bad.push(`${line}（斜線と * が同じ行にあります）`);
      }
    }
    return bad;
  }

  const art = pages.flatMap((p) =>
    blocks(p.text)
      .filter((b) => b.lang === '' && looksLikeGraphArt(b.body))
      .map((b) => [p.where, b.body] as const),
  );

  it('図を 1 つ以上見つけている', () => {
    expect(art.length).toBeGreaterThan(0);
  });

  it.each(art)('%s', (_, body) => {
    expect(misplaced(body)).toEqual([]);
  });
});

describe('記事の id が目次と食い違っていない', () => {
  const ids = new Set(DOCS.map((d) => d.id));

  it.each(pages.map((p) => [p.where, p] as const))('%s', (_, page) => {
    const nav = page.text.match(/<DocNav\s+id="([^"]+)"/);
    if (!nav) return; // 目次に載らないページ（はじめに）

    expect(ids.has(nav[1]), `${nav[1]} は DOCS にありません`).toBe(true);

    const path = page.text.match(/path:\s*'([^']+)'/);
    expect(path?.[1]).toBe(`/docs/${nav[1]}/`);
  });
});
