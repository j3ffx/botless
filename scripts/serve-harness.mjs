// Dev-only static server for dist/ and dist-test/ (harness + UI previews). Never used by the extension.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, normalize } from 'node:path';

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '') || 'dist-test/harness.js';
  if (!/^(dist|dist-test)[\\/]/.test(path)) {
    res.statusCode = 404;
    return res.end();
  }
  try {
    res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(8123, () => console.log('dev server on http://localhost:8123'));
