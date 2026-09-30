// End-to-end smoke test: loads dist/ into a real Chrome (Chrome for Testing) and checks what unit tests can't:
// the manifest loads, the service worker starts, the popup and Settings render without errors, the real
// bundles badge a tile on a (fake, offline) YouTube page, and nothing is requested while Active mode is off.
//
//   npm run build && CHROME_PATH=/path/to/chrome npm run smoke
//
// Get a Chrome for Testing binary with: npx @puppeteer/browsers install chrome@stable
// (branded Chrome ignores --load-extension since v137). Nothing here touches the real youtube.com:
// every request is intercepted and answered locally.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const executablePath = process.env.CHROME_PATH;
if (!executablePath) {
  console.error('Set CHROME_PATH to a Chrome for Testing binary (npx @puppeteer/browsers install chrome@stable).');
  process.exit(2);
}

const AI_CHANNEL = 'UCZy_1WNgqZXMqrYeKoX-n1A';
const UNKNOWN_CHANNEL = 'UC0000000000000000000000';
const PAGE_URL = 'https://www.youtube.com/results?search_query=botless-smoke';

// Two search tiles carrying renderer data the way YouTube does (docs/YOUTUBE-DOM.md): one channel marked AI,
// one never seen (Active mode would want to check it, so it proves no request is made while it's off).
const FAKE_YOUTUBE = `<!doctype html><html><head><title>fake youtube</title></head><body><ytd-app></ytd-app><script>
  const tile = (videoId, channelId) => {
    const el = document.createElement('ytd-video-renderer');
    el.innerHTML = '<ytd-thumbnail><a href="/watch?v=' + videoId + '">thumb</a></ytd-thumbnail><a href="/watch?v=' + videoId + '">title</a>';
    el.data = { videoId, ownerText: { runs: [{ text: 'Channel', navigationEndpoint: { browseEndpoint: { browseId: channelId } } }] } };
    document.querySelector('ytd-app').append(el);
  };
  tile('ZneqyXsgpO4', '${AI_CHANNEL}');
  tile('aaaaaaaaaaa', '${UNKNOWN_CHANNEL}');
</script></body></html>`;

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? '✓' : '✖'} ${msg}`);
  if (!ok) failures.push(msg);
};

/** Collects uncaught errors and console.error output from a page. */
function watchErrors(page, label) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  // "Failed to load resource" is Chrome logging the 503s this test answers with, not a script error.
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`${label}: ${m.text()}`));
  return errors;
}

/**
 * Extension pages may only load their own files. Anything else is blocked (the test stays offline) and recorded.
 * Call before goto().
 */
async function watchRequests(page, extId) {
  const outside = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith(`chrome-extension://${extId}/`) || url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
    outside.push(`${req.method()} ${url}`);
    return req.abort();
  });
  return outside;
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  pipe: true,
  enableExtensions: [resolve('dist')],
  args: ['--no-first-run', '--no-default-browser-check'],
});

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/sw.js'), { timeout: 10_000 });
  const extId = new URL(swTarget.url()).host;
  const sw = await swTarget.worker();
  check(!!sw, `service worker started (${extId})`);
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  check(manifest.name === 'Botless for YouTube', `manifest loaded, version ${manifest.version}`);
  const storage = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);

  // ---- Popup ----
  const popup = await browser.newPage();
  const popupErrors = watchErrors(popup, 'popup');
  const popupRequests = await watchRequests(popup, extId);
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'networkidle0' });
  check((await popup.$$('input[type="checkbox"]')).length === 2, 'popup shows its two switches');
  check(await popup.$eval('#enabled', (el) => el.checked), 'Botless is on by default');
  check(!(await popup.$eval('#youtube', (el) => el.checked)), 'Active mode is off by default');
  await popup.click('#enabled');
  await new Promise((r) => setTimeout(r, 200));
  const afterOff = (await storage('settings')).settings;
  check(afterOff?.enabled === false, 'turning Botless off from the popup is saved');
  await popup.click('#enabled');
  await new Promise((r) => setTimeout(r, 200));
  check((await storage('settings')).settings?.enabled === true, 'turning it back on is saved');
  check(popupErrors.length === 0, `popup has no errors${popupErrors.length ? `: ${popupErrors.join(' | ')}` : ''}`);
  check(popupRequests.length === 0, `popup loads nothing from outside the extension${popupRequests.length ? `: ${popupRequests.join(', ')}` : ''}`);
  await popup.close();

  // ---- Settings ----
  const options = await browser.newPage();
  const optionsErrors = watchErrors(options, 'options');
  const optionsRequests = await watchRequests(options, extId);
  await options.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'networkidle0' });
  check((await options.$$('input, select')).length > 5, 'Settings page renders its controls');
  check(optionsRequests.length === 0, `Settings loads nothing from outside the extension${optionsRequests.length ? `: ${optionsRequests.join(', ')}` : ''}`);

  // Import someone else's backup: marks and channels arrive, but their Active mode choice must not.
  const MARKED = 'UCmarkedmarkedmarkedmark';
  const OBSERVED = 'UCobservedobservedobserv';
  const backupFile = join(mkdtempSync(join(tmpdir(), 'botless-')), 'backup.json');
  writeFileSync(
    backupFile,
    JSON.stringify({
      app: 'botless-youtube',
      version: 1,
      exportedAt: 'not a date',
      settings: { youtubeRequests: true },
      overrides: { [MARKED]: { verdict: 'ai', at: 1 } },
      channels: { [OBSERVED]: { videos: { ZneqyXsgpO4: 1 }, firstSeen: 1, lastSeen: Date.now() } },
    }),
  );
  const status = () => options.$eval('#data-status', (el) => el.textContent);
  await (await options.$('#import-file')).uploadFile(backupFile);
  await options.waitForFunction(() => document.querySelector('#data-status')?.textContent, { timeout: 5_000 });
  const imported = await storage(['settings', 'overrides', `c:${OBSERVED}`]);
  check(!!imported.overrides?.[MARKED] && !!imported[`c:${OBSERVED}`], `import restores marks and channels (${await status()})`);
  check(imported.settings?.youtubeRequests === false, 'import leaves Active mode off');

  options.on('dialog', (d) => d.accept());
  await options.click('#clear-obs');
  await options.waitForFunction(() => /Cleared/.test(document.querySelector('#data-status')?.textContent ?? ''), { timeout: 5_000 });
  const cleared = await storage(['overrides', `c:${OBSERVED}`]);
  check(!cleared[`c:${OBSERVED}`] && !!cleared.overrides?.[MARKED], 'Clear observations forgets channels and keeps marks');
  check(optionsErrors.length === 0, `Settings has no errors${optionsErrors.length ? `: ${optionsErrors.join(' | ')}` : ''}`);
  await options.close();

  // ---- Content scripts on a fake YouTube page ----
  await sw.evaluate((id) => chrome.storage.local.set({ overrides: { [id]: { verdict: 'ai', at: Date.now() } } }), AI_CHANNEL);
  const yt = await browser.newPage();
  const ytErrors = watchErrors(yt, 'youtube');
  const requests = [];
  await yt.setRequestInterception(true);
  yt.on('request', (req) => {
    if (req.url() === PAGE_URL) return req.respond({ status: 200, contentType: 'text/html', body: FAKE_YOUTUBE });
    if (req.url() === 'https://www.youtube.com/favicon.ico') return req.respond({ status: 204 }); // the browser's, not ours
    requests.push(`${req.method()} ${req.url()}`);
    // Answer instead of aborting, so a request made by Botless shows up here rather than as a console error.
    return req.respond({ status: 503, contentType: 'text/plain', body: 'blocked by smoke test' });
  });
  await yt.goto(PAGE_URL, { waitUntil: 'load' });

  const badge = await yt
    .waitForSelector(`ytd-video-renderer[data-botless-cid="${AI_CHANNEL}"] .botless-badge`, { timeout: 5_000 })
    .catch(() => null);
  check(!!badge, 'the AI channel\'s tile gets a badge (bridge → content script → storage)');
  const stamped = await yt.$$eval('ytd-video-renderer[data-botless-cid]', (els) => els.length);
  check(stamped === 2, `both tiles stamped with their channel ID (${stamped}/2)`);

  await new Promise((r) => setTimeout(r, 4_000)); // longer than the check spacing: Active mode would have fired
  check(requests.length === 0, `no requests with Active mode off${requests.length ? `: ${requests.join(', ')}` : ''}`);

  // A page script forging the bridge's event (another extension, an injected script…) must not write anything.
  const FORGED = 'UCforgedforgedforgedforg';
  await yt.evaluate((cid) => {
    for (const url of [location.href, 'https://www.youtube.com/watch?v=aaaaaaaaaaa'])
      document.dispatchEvent(new CustomEvent('botless:page', { detail: JSON.stringify({ pageType: 'watch', url, videoId: 'aaaaaaaaaaa', channelId: cid, disclosure: 'ai' }) }));
  }, FORGED);
  await new Promise((r) => setTimeout(r, 500));
  check(!(await storage(`c:${FORGED}`))[`c:${FORGED}`], 'a forged page event records nothing');

  // Control: with Active mode on, the unknown channel's video *is* checked. Proves the watcher above works.
  const { settings } = await storage('settings');
  await sw.evaluate((s) => chrome.storage.local.set({ settings: { ...s, youtubeRequests: true } }), settings);
  await yt.reload({ waitUntil: 'load' });
  const deadline = Date.now() + 10_000;
  while (!requests.some((r) => r.includes('youtube.com/youtubei/v1/next')) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 250));
  const outside = requests.filter((r) => !/^(GET|POST) https:\/\/www\.youtube\.com\//.test(r));
  check(requests.some((r) => r.includes('youtube.com/youtubei/v1/next')), 'with Active mode on, the unknown channel gets checked');
  check(outside.length === 0, `Active mode only talks to www.youtube.com${outside.length ? `: ${outside.join(', ')}` : ''}`);
  check(ytErrors.length === 0, `no errors on the YouTube page${ytErrors.length ? `: ${ytErrors.join(' | ')}` : ''}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nSmoke test passed.');
