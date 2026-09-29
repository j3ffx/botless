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

// Local scripts, stylesheets and images referenced by the extension pages.
for (const page of [...referenced].filter((f) => f.endsWith('.html'))) {
  const html = existsSync(join(DIST, page)) ? readFileSync(join(DIST, page), 'utf8') : '';
  for (const [, url] of html.matchAll(/\b(?:src|href)="([^"#:]+)"/g)) referenced.add(url);
}

for (const f of referenced) if (!existsSync(join(DIST, f))) fail(`referenced but missing: ${f}`);

const all = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)]));
const files = all(DIST);

let jsBytes = 0;
for (const f of files) {
  if (f.endsWith('.map')) fail(`source map shipped: ${f}`);
  if (!f.endsWith('.js')) continue;
  jsBytes += statSync(f).size;
  const code = readFileSync(f, 'utf8');
  if (code.includes('sourceMappingURL')) fail(`inline source map in ${f} (built with --watch?)`);
  if (/\beval\s*\(|\bnew Function\s*\(/.test(code)) fail(`dynamic code (eval / new Function) in ${f}`);
  if (/\bimport\s*\(\s*['"`]https?:/.test(code)) fail(`remote import in ${f}`);
}
if (jsBytes > JS_BUDGET) fail(`JS bundles total ${jsBytes} B, over the ${JS_BUDGET} B budget`);

if (errors.length) {
  console.error(`dist/ check failed:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`dist/ OK: ${files.length} files, ${referenced.size} referenced, JS ${(jsBytes / 1024).toFixed(1)} KB / ${JS_BUDGET / 1024} KB`);
