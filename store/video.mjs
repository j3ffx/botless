// Records the promo video (store/pages/video.html: a canvas animation with a Web Audio soundtrack) to
// store/out/botless-promo.webm with Chrome's MediaRecorder, then checks it by playing it back: duration, both
// tracks, and sound levels. Real time: about 45 s to record, 45 s to check.
//   CHROME_PATH=… node store/video.mjs          (run store/render.mjs first: the video shows the popup image)
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { chromePath, need, OUT, serve } from './lib.mjs';

need(
  'store/captures/search-off.png', 'store/captures/search-badge.png', 'store/captures/search-fade.png',
  'store/captures/search-hide.png', 'store/captures/watch.png', 'store/out/screenshot-4-popup.png',
);
const FILE = join(OUT, 'botless-promo.webm');
const server = await serve();
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  // ---- Record ----
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  writeFileSync(FILE, '');
  let bytes = 0;
  await page.exposeFunction('saveChunk', (b64) => {
    const buf = Buffer.from(b64, 'base64');
    bytes += buf.length;
    appendFileSync(FILE, buf);
  });
  await page.goto(`${server.url}/store/pages/video.html`, { waitUntil: 'networkidle0' });
  const total = await page.evaluate(() => window.ready);
  console.log(`recording ${total.toFixed(1)} s…`);
  await page.evaluate(() => window.record());
  console.log(`saved store/out/botless-promo.webm (${(bytes / 1048576).toFixed(1)} MB)`);
  await page.close();

  // ---- Check by playing it back (the file has no seek index, so seeking would only show frame 0) ----
  const check = await browser.newPage();
  await check.goto(`${server.url}/store/pages/check-video.html`);
  const r = await check.evaluate(async () => {
    const v = document.getElementById('v');
    await new Promise((ok) => (v.readyState >= 1 ? ok() : v.addEventListener('loadedmetadata', ok, { once: true })));
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 2048;
    ac.createMediaElementSource(v).connect(an);
    an.connect(ac.destination);
    const buf = new Float32Array(an.fftSize), windows = [];
    let acc = 0, n = 0, peak = 0, clipped = 0, next = 1;
    await ac.resume();
    await v.play();
    await new Promise((ok) => {
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        for (const x of buf) { acc += x * x; n++; peak = Math.max(peak, Math.abs(x)); if (Math.abs(x) >= 0.999) clipped++; }
        if (v.currentTime >= next || v.ended) { windows.push(10 * Math.log10(acc / n + 1e-12)); acc = 0; n = 0; next += 1; }
        if (v.ended) ok(); else setTimeout(tick, 20);
      };
      tick();
    });
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, peakDb: 20 * Math.log10(peak + 1e-12), clipped, windows };
  });
  // Ignore the fades at both ends; anything quieter than -50 dBFS in between is a dropout.
  const middle = r.windows.slice(2, -3);
  const silent = middle.filter((db) => db < -50).length;
  console.log(`checked: ${r.duration.toFixed(1)} s, ${r.width}×${r.height}, peak ${r.peakDb.toFixed(1)} dBFS, ` +
    `${r.clipped} clipped samples, loudness ${Math.min(...middle).toFixed(0)} to ${Math.max(...middle).toFixed(0)} dBFS per second`);
  const ok = Math.abs(r.duration - total) < 3 && r.width === 1280 && r.height === 720 && r.clipped === 0 && silent === 0;
  if (!ok) console.error(`✖ something's off${silent ? ` (${silent} silent seconds)` : ''}: review the video before using it`);
  else console.log('✓ video and sound OK');
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
