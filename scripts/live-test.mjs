// Release test on REAL YouTube: loads a build into Chrome for Testing (headless, fresh profile, signed out) and
// runs the parts of docs/TESTING.md a script can: the AI label, auto-dub, badges, Active mode and its
// confirmations, and Botless off. Manual only, never in CI: it talks to youtube.com.
//
//   CHROME_PATH=… node scripts/live-test.mjs                    # dist/
//   CHROME_PATH=… node scripts/live-test.mjs path/to/unzipped   # any unpacked build
//   CHROME_PATH=… node scripts/live-test.mjs --release 0.1.5    # the zip attached to that GitHub release
//
// About 3 minutes, ~10 page loads and up to ~30 background checks. Don't run it many times in a row, and not
// over a VPN: YouTube may answer with its robot check (the test then stops and says so).
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';

const REPO = 'j3ffx/botless';
const CINEPHILES = 'UCZy_1WNgqZXMqrYeKoX-n1A'; // labels its Shorts (docs/TESTING.md)
const KEEMOKAZI = 'UCMOLiZpKXp-w5CNfqJObQUw'; // auto-dubbed only

if (!process.env.CHROME_PATH) {
  console.error('Set CHROME_PATH to a Chrome for Testing binary (npx @puppeteer/browsers install chrome@stable).');
  process.exit(2);
}

/** Unpacks a zip made by scripts/package.mjs (stored or deflated entries). */
function unzip(buf, dir) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen), local = buf.readUInt32LE(p + 42);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    const out = resolve(dir, name);
    if (!out.startsWith(resolve(dir))) throw new Error(`unsafe path in zip: ${name}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, method === 8 ? inflateRawSync(data) : data);
  }
}

let EXT, expected;
if (process.argv[2] === '--release') {
  expected = process.argv[3]?.replace(/^v/, '');
  if (!expected) throw new Error('usage: --release X.Y.Z');
  const url = `https://github.com/${REPO}/releases/download/v${expected}/botless-${expected}.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  EXT = mkdtempSync(join(tmpdir(), `botless-${expected}-`));
  unzip(Buffer.from(await res.arrayBuffer()), EXT);
  console.log(`testing the v${expected} release zip`);
} else {
  EXT = resolve(process.argv[2] ?? 'dist');
}
const { version } = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));

const results = [];
const check = (ok, msg) => {
  console.log(`${ok ? '✓' : '✖'} ${msg}`);
  results.push(ok);
};
/** For what depends on YouTube being up rather than on Botless. */
const skip = (msg) => console.log(`– ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  pipe: true,
  enableExtensions: [EXT],
  args: ['--no-first-run', '--no-default-browser-check', '--lang=en-US'],
  defaultViewport: { width: 1400, height: 1000 },
});

try {
  // YouTube registers its own /sw.js: only Botless's service worker lives at chrome-extension://.
  const swT = await browser.waitForTarget((t) => t.type() === 'service_worker' && /^chrome-extension:\/\/[^/]+\/sw\.js$/.test(t.url()));
  const sw = await swT.worker();
  check(!expected || version === expected, `Botless ${version} loads${expected ? ' (the release asked for)' : ''}`);
  await sleep(500);
  const storage = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);
  const setSettings = async (patch) => {
    const { settings } = await storage('settings');
    const next = { ...settings, ...patch, thresholds: { ...settings.thresholds, ...(patch.thresholds ?? {}) } };
    await sw.evaluate((s) => chrome.storage.local.set({ settings: s }), next);
  };

  const page = (await browser.pages())[0] ?? (await browser.newPage());
  const errors = [];
  page.on('pageerror', (e) => /chrome-extension:/.test(e.stack ?? '') && errors.push(e.message));
  const isExt = (url) => !!url?.startsWith('chrome-extension://');
  const fromExtension = (req) => {
    const i = req.initiator();
    return isExt(i?.url) || !!i?.stack?.callFrames?.some((f) => isExt(f.url));
  };
  const hosts = new Set();
  const log = [];
  let requests = 0, feeds = 0;
  const feedStatuses = [];
  page.on('request', (req) => {
    if (!fromExtension(req)) return;
    const u = new URL(req.url());
    requests++;
    if (u.pathname === '/feeds/videos.xml') feeds++;
    hosts.add(u.host);
  });
  page.on('response', (r) => {
    if (!fromExtension(r.request())) return;
    log.push(`${r.status()} ${r.url().slice(24, 90)}`);
    if (r.url().includes('/feeds/videos.xml')) feedStatuses.push(r.status());
  });
  page.on('requestfailed', (r) => fromExtension(r) && log.push(`FAILED ${r.failure()?.errorText} ${r.url().slice(24, 90)}`));

  /** Opens a URL; declines non-essential cookies on a consent page; stops on YouTube's robot check. */
  async function open(url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (/consent\./.test(page.url())) {
      const btn = await page.$('button[aria-label^="Reject"], form[action*="reject"] button');
      if (btn) await Promise.all([page.waitForNavigation({ timeout: 30_000 }).catch(() => {}), btn.click()]);
      console.log('  (consent page: rejected non-essential cookies)');
      if (URL.parse(page.url())?.hostname !== 'www.youtube.com') await page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    if (await page.$('iframe[src*="recaptcha"], #captcha-form')) {
      throw new Error('YouTube is showing its robot check to this connection (VPN? too many runs?). Try again later.');
    }
  }
  const pill = () =>
    page.waitForSelector('.botless-owner', { timeout: 20_000 }).then((el) => el.evaluate((e) => e.textContent.trim())).catch(() => null);
  const record = async (cid) => (await storage(`c:${cid}`))[`c:${cid}`];

  // ---- Defaults: Active mode off ----
  const { settings: defaults } = await storage('settings');
  check(defaults.enabled === true && defaults.youtubeRequests === false, 'defaults: Botless on, Active mode off');

  await open('https://www.youtube.com/watch?v=ZneqyXsgpO4');
  const p1 = await pill();
  check(/probably ai/i.test(p1 ?? ''), `a "Made with AI" video is Probably AI itself (pill: "${p1}")`);
  const c1 = await record(CINEPHILES);
  check(c1?.videos?.ZneqyXsgpO4 === 1, `its label is recorded for the channel (${JSON.stringify(c1?.videos)})`);
  check(c1?.cached?.verdict === 'inconclusive', `the channel stays Inconclusive after one labeled video (${c1?.cached?.verdict})`);

  await open('https://www.youtube.com/watch?v=LKQMw1WGL78');
  await sleep(6_000);
  const c2 = await record(KEEMOKAZI);
  check(c2?.videos?.LKQMw1WGL78 === 0, `an auto-dubbed video is recorded as not labeled (${JSON.stringify(c2?.videos)})`);
  const p2 = await page.$eval('.botless-owner', (e) => e.textContent.trim()).catch(() => null);
  check(!/AI/.test(p2 ?? ''), `an auto-dubbed video gets no AI verdict (pill: ${p2 ?? 'none'})`);

  await setSettings({ thresholds: { minVideosForRatio: 1 } });
  await open('https://www.youtube.com/watch?v=ZneqyXsgpO4');
  const p3 = await pill();
  check(/probably ai/i.test(p3 ?? ''), `with "minimum videos" at 1, the channel is Probably AI ("${p3}")`);

  await open('https://www.youtube.com/results?search_query=We+R+Cinephiles');
  await page.waitForSelector('[data-botless-cid]', { timeout: 20_000 }).catch(() => {});
  await sleep(4_000);
  const stamped = await page.$$eval('[data-botless-cid]', (els) => els.length);
  check(stamped > 3, `search tiles carry their channel IDs (${stamped})`);
  const badged = await page.$$eval(`[data-botless-cid="${CINEPHILES}"] .botless-badge`, (els) => els.map((e) => e.textContent.trim()));
  check(badged.length > 0, `that channel's tiles are badged in search (${badged.length}: ${[...new Set(badged)].join(', ')})`);
  check(requests === 0, `no requests of Botless's own with Active mode off (${requests})`);
  check(((await storage('checks')).checks?.count ?? 0) === 0, 'no background checks counted with Active mode off');

  // ---- Active mode on, default thresholds: verdicts must come from real confirmations ----
  await setSettings({ thresholds: { minVideosForRatio: defaults.thresholds.minVideosForRatio }, youtubeRequests: true });
  const before = new Set(Object.keys(await storage(null)).filter((k) => k.startsWith('c:')));
  await open('https://www.youtube.com/results?search_query=ai+generated+short+film');
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => scrollBy(0, 400));
    await sleep(6_000);
  }
  const { checks } = await storage('checks');
  check((checks?.count ?? 0) >= 10, `Active mode checks tiles on screen (${checks?.count ?? 0} checks in 72 s, at most 1 per 3 s)`);
  check(!(checks?.backoffUntil > Date.now()), 'YouTube accepted them (no pause)');
  check(requests > 0 && [...hosts].every((h) => h === 'www.youtube.com'), `they only go to www.youtube.com (${requests} to ${[...hosts].join(', ')})`);
  const all = await storage(null);
  const learned = Object.keys(all).filter((k) => k.startsWith('c:') && !before.has(k));
  check(learned.length > 2, `channels are learned without opening videos (${learned.length} new)`);
  check(feeds > 0, `first labels get a confirming check (${feeds} channel feeds read)`);
  const confirmed = learned.map((k) => all[k]).filter((r) => r.cached?.verdict === 'ai').map((r) => `${r.name} ${JSON.stringify(r.videos)}`);
  if (feeds > 0 && !feedStatuses.includes(200)) {
    // YouTube's channel feeds are often down; confirmations then can't happen (not Botless's fault).
    skip(`skipped "channels reach Probably AI on their own": YouTube's channel feeds are down (${feedStatuses.join(', ')})`);
  } else {
    check(confirmed.length > 0, `channels reach Probably AI on their own, with default thresholds (${confirmed.join('; ') || 'none'})`);
  }

  await setSettings({ youtubeRequests: false });
  const n = (await storage('checks')).checks?.count;
  await page.evaluate(() => scrollBy(0, 2000));
  await sleep(8_000);
  const m = (await storage('checks')).checks?.count;
  check(m === n, `turning Active mode off stops the checks (${n} → ${m})`);

  // ---- Botless off ----
  await setSettings({ enabled: false });
  await sleep(1_500);
  const left = await page.$$eval('.botless-badge, .botless-owner', (els) => els.length);
  check(left === 0, `turning Botless off removes every badge (${left} left)`);
  const snapshot = JSON.stringify(await storage(null));
  await open('https://www.youtube.com/results?search_query=veritasium');
  await page.waitForSelector('[data-botless-cid]', { timeout: 20_000 }).catch(() => {});
  await open('https://www.youtube.com/watch?v=JsBZOcqZerk');
  await sleep(6_000);
  check(JSON.stringify(await storage(null)) === snapshot, 'with Botless off, browsing changes nothing in storage');

  check(errors.length === 0, `no errors from Botless's scripts${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  const passed = results.filter(Boolean).length;
  if (passed < results.length) console.log(`\nBotless's own requests:\n  ${log.join('\n  ')}`);
  console.log(`\n${passed}/${results.length} passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (e) {
  console.error(`\n${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
