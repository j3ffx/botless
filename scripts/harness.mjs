// Dev-only: bundles the built extension scripts plus an in-memory chrome.* shim into one file that can be
// injected into a live youtube.com tab for smoke testing without installing the extension.
// Usage: npm run build && node scripts/harness.mjs  ->  dist-test/harness.js
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const shim = `
(() => {
  const store = window.__BOTLESS_SEED__ ? JSON.parse(JSON.stringify(window.__BOTLESS_SEED__)) : {};
  const changeL = [], msgL = [];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const fire = (ch) => setTimeout(() => changeL.forEach((f) => f(ch, 'local')));
  const local = {
    async get(keys) {
      if (keys == null) return clone(store);
      const ks = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const o = {};
      for (const k of ks) if (k in store) o[k] = clone(store[k]);
      return o;
    },
    async set(obj) {
      const ch = {};
      for (const [k, v] of Object.entries(obj)) { ch[k] = { oldValue: store[k], newValue: clone(v) }; store[k] = clone(v); }
      fire(ch);
    },
    async remove(keys) {
      const ch = {};
      for (const k of [].concat(keys)) { ch[k] = { oldValue: store[k] }; delete store[k]; }
      fire(ch);
    },
    async getBytesInUse() { return JSON.stringify(store).length; },
  };
  const ev = (arr) => ({ addListener: (f) => arr.push(f) });
  window.__botlessStore = store;
  window.chrome = {
    storage: { local, onChanged: ev(changeL) },
    runtime: {
      id: 'botless-harness',
      onMessage: ev(msgL), onInstalled: ev([]), onStartup: ev([]),
      sendMessage(msg) {
        return new Promise((res) => {
          let done = false;
          for (const f of msgL) f(msg, {}, (v) => { if (!done && v !== undefined) { done = true; res(v); } });
          setTimeout(() => !done && res(undefined), 3000);
        });
      },
    },
  };
})();
`;

const css = readFileSync('dist/content.css', 'utf8');
const style = `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.append(s); })();`;
const parts = [shim, style, readFileSync('dist/sw.js', 'utf8'), readFileSync('dist/bridge.js', 'utf8'), readFileSync('dist/content.js', 'utf8')];
mkdirSync('dist-test', { recursive: true });
writeFileSync('dist-test/harness.js', parts.join('\n;\n'));
console.log('dist-test/harness.js', parts.join('').length, 'bytes');
