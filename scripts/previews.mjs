// Dev-only: generates dist-test/*.html previews of the popup, options page and injected UI, backed by a
// fake chrome.* API with realistic seeded data. Run after `npm run build`, then serve them over HTTP with
// `node scripts/serve-harness.mjs` (opening them from disk can break the relative scripts).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

mkdirSync('dist-test', { recursive: true });
const now = Date.now();
const CID = 'UCZy_1WNgqZXMqrYeKoX-n1A';

const seed = {
  settings: { enabled: true, autoSkip: true },
  stats: { day: new Date().toISOString().slice(0, 10), ids: Array.from({ length: 14 }, (_, i) => `vid${i}`) },
  overrides: {
    'UCHnyfMqiRRG1u-2MsSQLbXA': { verdict: 'human', name: 'Veritasium', at: now - 86400e3 * 3 },
    UCaiaiaiaiaiaiaiaiaiaiai: { verdict: 'ai', name: 'Lofi Dream Machine 24/7', at: now - 86400e3 },
  },
  [`c:${CID}`]: { id: CID, name: 'We R Cinephiles', videos: { ZneqyXsgpO4: 1, GtSpreu25u8: 1, abcdefghijk: 1 }, firstSeen: now, lastSeen: now },
};

const shim = (pageInfo) => `
(() => {
  const store = ${JSON.stringify(seed)};
  store.stats.day = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })();
  const L = [];
  const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const local = {
    async get(k) { if (k == null) return clone(store); const ks = [].concat(k); const o = {}; for (const x of ks) if (x in store) o[x] = clone(store[x]); return o; },
    async set(o) { const ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { newValue: clone(v) }; store[k] = clone(v); } setTimeout(() => L.forEach((f) => f(ch, 'local'))); },
    async remove(k) { for (const x of [].concat(k)) delete store[x]; },
    async getBytesInUse() { return JSON.stringify(store).length; },
  };
  const summary = (id) => {
    const ov = store.overrides?.[id];
    if (ov) return { channelId: id, override: ov, record: store['c:' + id], result: { verdict: ov.verdict, score: 1, reasons: [{ signal: 'override', text: 'You marked this channel as ' + (ov.verdict === 'ai' ? 'AI' : 'human'), weight: ov.verdict === 'ai' ? 1 : -1 }] } };
    return { channelId: id, record: store['c:' + id], result: { verdict: 'ai', score: 1, reasons: [
      { signal: 'ratio', text: "3 of 3 videos you've watched carry YouTube's AI label (100% ≥ 90%)", weight: 1 } ] } };
  };
  window.chrome = {
    storage: { local, onChanged: { addListener: (f) => L.push(f) } },
    tabs: {
      async query() { return [{ id: 1, url: 'https://www.youtube.com/watch?v=ZneqyXsgpO4' }]; },
      async sendMessage() { return { page: ${JSON.stringify(pageInfo)} }; },
    },
    runtime: {
      openOptionsPage() {},
      async sendMessage(m) {
        if (m.type === 'setOverride') {
          store.overrides ??= {};
          if (m.verdict) store.overrides[m.channelId] = { verdict: m.verdict, name: m.name, at: Date.now() };
          else delete store.overrides[m.channelId];
          L.forEach((f) => f({ overrides: { newValue: clone(store.overrides) } }, 'local'));
        }
        return summary(m.channelId);
      },
    },
  };
})();`;

const page = { pageType: 'watch', url: 'x', videoId: 'ZneqyXsgpO4', channelId: CID, channelName: 'We R Cinephiles', disclosure: 'ai' };
writeFileSync('dist-test/shim-popup.js', shim(page));

for (const name of ['popup', 'options']) {
  const html = readFileSync(`dist/${name}.html`, 'utf8')
    .replace('<head>', '<head>\n    <base href="../dist/" />')
    .replace(`<script src="${name}.js">`, `<script src="../dist-test/shim-popup.js"></script>\n    <script src="${name}.js">`);
  writeFileSync(`dist-test/${name}.html`, html);
}

// Injected UI (thumbnail badges, owner pill, toast) in YouTube's light and dark themes.
const block = (dark) => `
<section class="${dark ? 'dark' : 'light'}">
  <h2>${dark ? 'YouTube dark theme' : 'YouTube light theme'}</h2>
  <div class="thumbs">
    ${['ai', 'inconclusive', 'human'].map((v) => `
    <div class="thumb botless-anchor"><span class="botless-badge botless-${v}"><span class="botless-dot"></span>${{ ai: 'Probably AI', inconclusive: 'Inconclusive', human: 'Probably Human' }[v]}</span></div>`).join('')}
    <div class="thumb botless-anchor botless-fade"><span class="botless-badge botless-ai"><span class="botless-dot"></span>Probably AI</span></div>
  </div>
  <p class="cap">Badge on thumbnails · last tile uses “Fade”</p>
  <div class="owner">We R Cinephiles
    <span class="botless-owner botless-ai"><span class="botless-dot"></span>Probably AI</span>
    <span class="botless-owner botless-inconclusive"><span class="botless-dot"></span>Inconclusive</span>
    <span class="botless-owner botless-human"><span class="botless-dot"></span>Probably Human</span>
  </div>
  <div class="toastwrap"><div class="botless-toast" style="position:static;transform:none;animation:none;--botless-delay:9999s">
    <span class="botless-toast-msg"><b>Skipping likely-AI video</b></span><button type="button">Undo</button><span class="botless-toast-bar" style="transform:scaleX(.55);animation:none"></span>
  </div></div>
</section>`;
const css = readFileSync('dist/content.css', 'utf8');
writeFileSync(
  'dist-test/content-preview.html',
  `<!doctype html><html><head><meta charset="utf-8"><title>Injected UI preview</title><style>${css}
body{margin:0;font:14px Roboto,Arial,sans-serif}
section{padding:20px 24px}
section.light{background:#fff;color:#0f0f0f}
section.dark{background:#0f0f0f;color:#f1f1f1}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;opacity:.6;margin:0 0 12px}
.thumbs{display:flex;gap:12px;flex-wrap:wrap}
.thumb{width:200px;height:112px;border-radius:12px;background:linear-gradient(135deg,#556,#9aa 60%,#dcb)}
.cap{font-size:12px;opacity:.6}
.owner{display:flex;align-items:center;gap:0;font-weight:500;margin:14px 0}
.toastwrap{display:flex}
</style></head><body></body></html>`.replace('<body></body>', `<body>${block(false)}<div id="d"></div></body>`),
);
// Dark section needs html[dark]; render it in an iframe-free way by duplicating rules under .dark.
const darkCss = css.replace(/html\[dark\]/g, 'section.dark');
writeFileSync(
  'dist-test/content-preview.html',
  readFileSync('dist-test/content-preview.html', 'utf8').replace('<div id="d"></div>', `<style>${darkCss}</style>${block(true)}`),
);
console.log('previews written to dist-test/');
