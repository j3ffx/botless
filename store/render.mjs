// Renders every Chrome Web Store image into store/out/ (see store/README.md):
// 5 screenshots (1280×800), the promo tiles, the YouTube thumbnail and the store icon.
//   CHROME_PATH=… node store/render.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CAPTURES, chromePath, need, OUT, ROOT, serve } from './lib.mjs';

need('store/captures/watch.png', 'store/captures/search-badge.png', 'store/captures/search-fade.png');
const run = (script) => execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'inherit' });
run('scripts/build.mjs'); // the previews use the built popup and Settings pages
run('scripts/previews.mjs'); // → dist-test/popup.html, options.html (fake data, made-up channel)

const shot = (img, title, sub) =>
  `/store/pages/compose-shot.html?img=${img}&t=${encodeURIComponent(title)}&s=${encodeURIComponent(sub)}`;
const JOBS = [
  [shot('search-badge.png', 'Probably AI, from YouTube’s own label', 'Channels are judged on the AI disclosure YouTube shows on their videos.'), 'screenshot-2-badges.png', 1280, 800],
  [shot('search-fade.png', 'Fade them, or hide them completely', 'Choose what happens to each verdict. Auto-skip is optional.'), 'screenshot-3-fade.png', 1280, 800],
  ['/store/pages/compose-popup.html', 'screenshot-4-popup.png', 1280, 800],
  ['/dist-test/options.html', 'screenshot-5-settings.png', 1280, 800, 'dark'],
  ['/store/pages/promo-tile.html', 'promo-small-440x280.png', 440, 280],
  ['/store/pages/marquee.html', 'promo-marquee-1400x560.png', 1400, 560],
  ['/store/pages/thumbnail.html', 'youtube-thumbnail.png', 1280, 720],
];

mkdirSync(OUT, { recursive: true });
copyFileSync(join(CAPTURES, 'watch.png'), join(OUT, 'screenshot-1-watch.png')); // already 1280×800, as captured
copyFileSync(join(ROOT, 'src/static/icons/icon-128.png'), join(OUT, 'store-icon-128.png'));

const server = await serve();
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
try {
  for (const [path, out, width, height, scheme] of JOBS) {
    const page = await browser.newPage();
    page.on('requestfailed', (r) => console.warn(`  ${out}: failed to load ${r.url()}`));
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    if (scheme) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.goto(server.url + path, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: join(OUT, out) });
    await page.close();
    console.log(`rendered ${out}`);
  }
} finally {
  await browser.close();
  server.close();
}
