// Builds the GitHub Pages site: site/ as is, with privacy.html filled in from PRIVACY.md, so the published
// policy is always the one in the repository. Markdown is rendered by GitHub's own API (same output as on
// github.com, no dependency). Run by .github/workflows/pages.yml; locally: node scripts/build-site.mjs [outDir]
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? '_site';
const REPO = 'j3ffx/botless';

rmSync(OUT, { recursive: true, force: true });
cpSync('site', OUT, { recursive: true });

const headers = { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const res = await fetch('https://api.github.com/markdown', {
  method: 'POST',
  headers,
  body: JSON.stringify({ text: readFileSync('PRIVACY.md', 'utf8'), mode: 'markdown', context: REPO }),
});
if (!res.ok) throw new Error(`GitHub Markdown API answered ${res.status}: ${await res.text()}`);

// Links relative to the repository (README.md#privacy, SECURITY.md) point at the files on GitHub.
let body = (await res.text()).replace(
  /href="(?!https?:|#|mailto:)([^"]+)"/g,
  (_, path) => `href="https://github.com/${REPO}/blob/main/${path}"`,
);

// On phones, style.css shows each table row as a card: every cell gets its column heading as a label.
// A label is a heading's text, escaped for the attribute: once tags are stripped, nothing left can open one.
const ESC = { '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/[<>"]/g, (c) => ESC[c]).trim();
body = body.replace(/<table[\s\S]*?<\/table>/g, (table) => {
  const labels = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
  return table.replace(/<tr>([\s\S]*?)<\/tr>/g, (row, cells) => {
    let i = 0;
    return `<tr>${cells.replace(/<td(?=[\s>])/g, () => `<td data-label="${labels[i++] ?? ''}"`)}</tr>`;
  });
});
// The first list is "The short version": shown as a summary box.
body = body.replace('<ul>', '<ul class="summary">');

const page = join(OUT, 'privacy.html');
const html = readFileSync(page, 'utf8');
const marked = /<!-- privacy:start[^>]*-->[\s\S]*?<!-- privacy:end -->/;
if (!marked.test(html)) throw new Error('site/privacy.html lost its privacy:start / privacy:end markers');
writeFileSync(page, html.replace(marked, () => body));
console.log(`site built in ${OUT}/ (privacy.html from PRIVACY.md, ${body.length} bytes)`);
