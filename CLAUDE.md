# Botless for YouTube — contributor notes

MV3 Chrome extension (TypeScript, esbuild, vitest; no framework). Read first:

- `README.md` covers what it does, the verdict model, permissions, privacy and architecture.
- `docs/YOUTUBE-DOM.md` covers every YouTube selector and data path, verified live, with dates.
- `docs/TESTING.md` is the manual test plan, with real test video IDs.
- `docs/ROADMAP.md` lists decisions already made (with reasons), removed features, and open items.

## Commands

```bash
npm run build        # -> dist/ (load unpacked in Chrome)
npx tsc --noEmit     # typecheck
npx vitest run       # unit tests
```

Run typecheck, tests and build before every commit. Keep commits small and logical, with messages that
explain *why*.

## Invariants (discuss before changing)

- **Privacy.** With "Active mode" off (the default), Botless makes no requests of its own. The only `fetch`
  calls live in `src/content/checker.ts`, go to `www.youtube.com` with `credentials: "omit"`, and are
  rate-limited by the service worker (`checkPermit`). The service worker and the MAIN-world bridge never
  fetch.
- **Never act on the user's YouTube account** (feedback, likes, subscriptions…). A "Don't recommend
  channel" feature was built and then removed (see ROADMAP).
- **Popup: at most two switches:** Botless on/off, and Active mode. Anything else goes in Settings.
- The UI never claims certainty: "Probably AI / Probably Human / Inconclusive".
- Pure logic stays in `src/shared/*` (no DOM, no `chrome.*`) with unit tests. The scoring weights live
  only in `src/shared/scoring.ts`.
- The service worker is the single writer for channel data (`serial()` queue). Content scripts read
  storage and message the service worker.
- MAIN-world `src/bridge/bridge.ts`: no `chrome.*`, no storage, no network. It passes data to the isolated
  world only via `data-botless-*` attributes and JSON-**string** CustomEvents (`botless:page`,
  `botless:scan`, `botless:request-page`).
- Only trust `browseEndpoint.browseId` for channel IDs, never a `/UC.{22}/` regex (tracking params match
  it).
- When a selector or data path changes, verify it on live YouTube first, then update
  `docs/YOUTUBE-DOM.md`.

## Verifying changes without installing the extension

1. **Live harness:** `npm run build && node scripts/harness.mjs` produces `dist-test/harness.js` (an
   in-memory `chrome.*` shim + service worker + bridge + content script). Paste it into a YouTube tab's
   DevTools console; YouTube's CSP blocks loading it from a local server. Seed storage first with
   `window.__BOTLESS_SEED__ = { overrides: {...}, settings: {...} }`. The scripts survive YouTube's SPA
   navigation. To navigate in-app without a reload:
   ```js
   document.querySelector('ytd-app').dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true,
     detail: { endpoint: { commandMetadata: { webCommandMetadata: { url: '/watch?v=ID', webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } }, watchEndpoint: { videoId: 'ID' } } } }));
   ```
2. **Popup / options previews:** `node scripts/previews.mjs && node scripts/serve-harness.mjs`, then open
   `http://localhost:8123/dist-test/popup.html` or `options.html`. They're backed by a fake `chrome.*` with
   seeded data. Serve them over HTTP: opening them via `file://` can break the relative scripts.
3. **Background tabs:** browsers pause `requestAnimationFrame` in hidden tabs, and Botless applies badges
   in rAF. YouTube also skips laying out menus and the Shorts overlay there. Test in a visible tab.
4. The full behaviour can only be confirmed in real Chrome with `dist/` loaded unpacked (`docs/TESTING.md`).
