// Checks the built extension in dist/ before it is packaged: everything the manifest and pages reference
// exists, no source maps or dynamic code ship (MV3 forbids remote/eval'd code), and the bundles stay small.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
// The README promises light bundles (~46 KB in 2026-09). Raise this deliberately, not by accident.
const JS_BUDGET = 64 * 1024;

const errors = [];
const fail = (msg) => errors.push(msg);

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('dist/manifest.json is missing. Run `npm run build` first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

if (manifest.version !== pkg.version) fail(`manifest version ${manifest.version} != package.json ${pkg.version}`);

const referenced = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...Object.values(manifest.icons ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
]);
referenced.delete(undefined);

// Local scripts, stylesheets and images referenced by the extension pages. Anything an element *loads* from
// another origin (remote script, stylesheet, image, frame…) is refused: extension pages must be self-contained.
const REMOTE = /^(?:[a-z][\w+.-]*:)?\/\//i;
for (const page of [...referenced].filter((f) => f.endsWith('.html'))) {
  const html = existsSync(join(DIST, page)) ? readFileSync(join(DIST, page), 'utf8') : '';
  for (const [, url] of html.matchAll(/\b(?:src|href)="([^"#:]+)"/g)) referenced.add(url);
  for (const [, tag, url] of html.matchAll(/<(script|link|img|iframe|frame|source|video|audio|embed|object|input)\b[^>]*?\s(?:src|href|srcset|data|poster)="([^"]*)"/gi))
    if (REMOTE.test(url)) fail(`remote resource in ${page}: <${tag}> loads ${url}`);
}

for (const f of referenced) if (!existsSync(join(DIST, f))) fail(`referenced but missing: ${f}`);

const all = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)]));
const files = all(DIST);

// Only the content script may make requests (src/content/checker.ts); the other bundles must not even mention
// a network API. Complements tests/invariants.test.ts by checking what esbuild actually shipped.
const NO_NETWORK = new Set(['sw.js', 'bridge.js', 'popup.js', 'options.js']);
const NETWORK_API = /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|WebTransport)\b/;

let jsBytes = 0;
for (const f of files) {
  if (f.endsWith('.map')) fail(`source map shipped: ${f}`);
  if (f.endsWith('.css')) {
    const css = readFileSync(f, 'utf8');
    if (/@import\b/i.test(css)) fail(`@import in ${f}`);
    for (const [, url] of css.matchAll(/url\(\s*['"]?([^'")\s]*)/gi)) if (REMOTE.test(url)) fail(`remote url() in ${f}: ${url}`);
  }
  if (!f.endsWith('.js')) continue;
  jsBytes += statSync(f).size;
  const code = readFileSync(f, 'utf8');
  if (code.includes('sourceMappingURL')) fail(`inline source map in ${f} (built with --watch?)`);
  if (/\beval\s*\(|\bFunction\s*\(/.test(code)) fail(`dynamic code (eval / Function) in ${f}`);
  if (/\bimport\s*\(/.test(code)) fail(`dynamic import in ${f}`);
  const name = f.split(/[\\/]/).pop();
  if (NO_NETWORK.has(name) && NETWORK_API.test(code)) fail(`network API in ${name}: ${NETWORK_API.exec(code)[0]}`);
}
if (jsBytes > JS_BUDGET) fail(`JS bundles total ${jsBytes} B, over the ${JS_BUDGET} B budget`);

if (errors.length) {
  console.error(`dist/ check failed:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`dist/ OK: ${files.length} files, ${referenced.size} referenced, JS ${(jsBytes / 1024).toFixed(1)} KB / ${JS_BUDGET / 1024} KB`);
