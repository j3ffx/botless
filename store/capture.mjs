// Takes the real YouTube screenshots the store images and the video use, in a VISIBLE Chrome for Testing with
// dist/ loaded, signed out, region and language forced to US English. Step by step, because picking a clean
// view is a human call (store/README.md says what to avoid):
//
//   node store/capture.mjs launch                    open the window (keep it open between steps)
//   node store/capture.mjs search "<query>" [secs]   Active mode on, scroll the search; one candidate image
//                                                    per cluster of badges → store/captures/candidates/
//   node store/capture.mjs modes "<query>" <scrollY> that view with Botless off, then badge, fade and hide
//                                                    → store/captures/search-{off,badge,fade,hide}.png
//   node store/capture.mjs watch <videoId>           a watch page → store/captures/watch.png
//   node store/capture.mjs close
//
// Not over a VPN: YouTube then shows its robot check. If it does anyway, solve it in the window yourself.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CAPTURES, chromePath, need, ROOT } from './lib.mjs';

const PORT = 9333;
const PROFILE = join(ROOT, 'store', '.profile'); // git-ignored
const DIST = join(ROOT, 'dist');
const [cmd, ...args] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (cmd === 'launch') {
  need('dist/manifest.json');
  spawn(chromePath(), [
    `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, `--load-extension=${DIST}`,
    '--no-first-run', '--no-default-browser-check', '--lang=en-US', '--window-size=1300,1000',
    // Count as visible even behind other windows: Botless (rightly) idles in hidden tabs.
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    'https://www.youtube.com/',
  ], { detached: true, stdio: 'ignore' }).unref();
  console.log('Chrome is starting. Run the other steps; "close" when done.');
  process.exit(0);
}

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }).catch(() => {
  console.error('No capture window: run "node store/capture.mjs launch" first.');
  process.exit(2);
});
if (cmd === 'close') {
  await browser.close();
  process.exit(0);
}

// Botless's settings, through one of its own pages (its service worker sleeps when idle).
// Its ID: from its service worker while awake (right after launch), else from the profile's preferences
// (written by Chrome a little after a new profile starts).
const prefs = (f) => { try { return JSON.parse(readFileSync(join(PROFILE, 'Default', f), 'utf8')); } catch { return {}; } };
let extId;
for (let i = 0; i < 20 && !extId; i++, await sleep(1000)) {
  const sw = browser.targets().find((t) => t.type() === 'service_worker' && /^chrome-extension:\/\/[^/]+\/sw\.js$/.test(t.url()));
  const exts = { ...prefs('Preferences').extensions?.settings, ...prefs('Secure Preferences').extensions?.settings };
  extId = sw ? new URL(sw.url()).host : Object.entries(exts).find(([, v]) => /[\\/]dist$/i.test(v?.path ?? ''))?.[0];
}
if (!extId) throw new Error('Botless not found in the capture window: is dist/ built?');
const ext = await browser.newPage();
await ext.goto(`chrome-extension://${extId}/options.html`);
const storage = (k) => ext.evaluate((x) => chrome.storage.local.get(x), k);
const set = async (patch) => {
  const { settings } = await storage('settings');
  await ext.evaluate((s) => chrome.storage.local.set({ settings: s }), { ...settings, ...patch, actions: { ...settings.actions, ...(patch.actions ?? {}) } });
};
const page = (await browser.pages()).find((p) => URL.parse(p.url())?.hostname === 'www.youtube.com') ?? (await browser.newPage());
await page.bringToFront();
await page.setViewport({ width: 1280, height: 800 });
await page.setCookie({ name: 'PREF', value: 'gl=US&hl=en', domain: '.youtube.com', path: '/', secure: true });
async function open(url, wait = 8000) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await sleep(wait);
  // YouTube may still be swapping documents right after load: a failed probe just means "not the robot check".
  if (await page.$('iframe[src*="recaptcha"], #captcha-form').catch(() => null)) {
    console.log('YouTube shows its robot check: solve it in the window, then rerun this step.');
  }
}
const search = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
mkdirSync(CAPTURES, { recursive: true });

try {
  if (cmd === 'search') {
    const [query, secs = '90'] = args;
    await set({ enabled: true, youtubeRequests: true, actions: { ai: 'badge' } });
    await open(search(query));
    for (const end = Date.now() + Number(secs) * 1000; Date.now() < end; await sleep(7000)) await page.evaluate(() => scrollBy(0, 350));
    await sleep(15_000); // let confirmations finish
    const ys = await page.evaluate(() =>
      [...document.querySelectorAll('.botless-badge')].map((b) => Math.round(b.getBoundingClientRect().top + scrollY)).sort((a, b) => a - b));
    const tops = ys.filter((y, i) => i === 0 || y - ys[i - 1] > 500);
    const dir = join(CAPTURES, 'candidates');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const y of tops) {
      const scrollY = Math.max(0, y - 140);
      await page.evaluate((t) => scrollTo(0, t), scrollY);
      await sleep(1500);
      await page.screenshot({ path: join(dir, `scrollY-${scrollY}.png`) });
    }
    console.log(`${ys.length} badges, ${tops.length} candidates in store/captures/candidates/ (file name = scrollY for "modes")`);
  } else if (cmd === 'modes') {
    const [query, scrollY] = args;
    await open(search(query));
    for (const [name, patch] of [
      ['off', { enabled: false }],
      ['badge', { enabled: true, actions: { ai: 'badge' } }],
      ['fade', { actions: { ai: 'fade' } }],
      ['hide', { actions: { ai: 'hide' } }],
    ]) {
      await set(patch);
      await sleep(2000);
      await page.evaluate((y) => scrollTo(0, y), Number(scrollY));
      await sleep(1500);
      await page.screenshot({ path: join(CAPTURES, `search-${name}.png`) });
      console.log(`saved store/captures/search-${name}.png`);
    }
    await set({ actions: { ai: 'badge' } });
  } else if (cmd === 'watch') {
    await set({ enabled: true });
    await open(`https://www.youtube.com/watch?v=${args[0]}`, 10_000);
    const pill = await page.$eval('.botless-owner', (e) => e.textContent.trim()).catch(() => 'none');
    await page.screenshot({ path: join(CAPTURES, 'watch.png') });
    console.log(`saved store/captures/watch.png (Botless label: ${pill})`);
  } else {
    console.error('commands: launch | search "<query>" [secs] | modes "<query>" <scrollY> | watch <videoId> | close');
    process.exitCode = 2;
  }
} finally {
  await ext.close().catch(() => {});
  browser.disconnect();
}
