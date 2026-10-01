// Shared by the store tools (capture, render, video): paths, Chrome for Testing, and a tiny static server
// rooted at the repository, so the pages can load the icon, the captures and the popup preview.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CAPTURES = join(ROOT, 'store', 'captures'); // real YouTube screenshots: git-ignored (other creators' content)
export const OUT = join(ROOT, 'store', 'out'); // generated images and video: git-ignored

export function chromePath() {
  const p = process.env.CHROME_PATH;
  if (!p) {
    console.error('Set CHROME_PATH to a Chrome for Testing binary (npx @puppeteer/browsers install chrome@stable).');
    process.exit(2);
  }
  return p;
}

/** Fails early, listing what's missing, instead of rendering pages with broken images. */
export function need(...files) {
  const missing = files.filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`Missing:\n  ${missing.join('\n  ')}\nSee store/README.md for how to make them.`);
    process.exit(2);
  }
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.webm': 'video/webm',
};

/** Serves the repository on 127.0.0.1 (random port). Returns { url, close }. */
export async function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
