import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';

/**
 * out/ をそのまま配る、検査用の静的サーバ。
 * output: 'export' なので next start は使えず、GitHub Pages と同じく
 * ただのファイル配信で動くことを、ここで確かめる意味もある。
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function serveStatic(root: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // basePath ぶんを剥がす。GitHub Pages ではこれをホスト側がやっている。
    const path = decodeURIComponent(url.pathname).replace(/^\/git-manabe/, '') || '/';

    // ディレクトリなら index.html（trailingSlash: true の書き出しに合わせる）
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;

    if (!existsSync(file)) {
      // GitHub Pages と同じく、無い住所には 404.html を返す
      const notFound = join(root, '404.html');
      if (existsSync(notFound)) {
        res.writeHead(404, { 'content-type': TYPES['.html'] });
        createReadStream(notFound).pipe(res);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }

    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}
