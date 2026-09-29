# Botless for YouTube — notes for coding agents

MV3 Chrome extension (TypeScript, esbuild, vitest; no framework). Read first:

- `README.md` covers what it does, the verdict model, permissions, privacy and architecture.
- `docs/YOUTUBE-DOM.md` covers every YouTube selector and data path, verified live, with dates.
- `docs/TESTING.md` is the manual test plan, with real test video IDs.
- `docs/ROADMAP.md` lists decisions already made (with reasons), rejected and removed features, and open items.

## Commands

```bash
npm run build        # -> dist/ (load unpacked in Chrome)
npx tsc --noEmit     # typecheck
npx vitest run       # unit tests
node scripts/previews.mjs && node scripts/harness.mjs   # dev-only previews / live harness -> dist-test/
```

Run typecheck, tests and build before every commit.

## Conventions

- **Git identity:** this repo uses the owner's *personal* email, set repo-locally
  (`48691129+j3ffx@users.noreply.github.com`).
- Remote `origin` is `github.com/j3ffx/botless` (private), branch `main`. The owner allows committing and
  pushing directly once checks pass. Make small logical commits with explanatory messages.
- The owner writes in English, uses YouTube in French, and tests in their own Chrome, signed in.

## Invariants (don't break without asking the owner)

- **Privacy.** With "Active mode" off (the default), Botless makes no requests of its own. The only `fetch`
  calls live in `src/content/checker.ts`, go to `www.youtube.com` with `credentials: "omit"`, and are
  rate-limited by the service worker (`checkPermit`). The service worker and the MAIN-world bridge never
  fetch.
- **Never act on the user's YouTube account** (feedback, likes, subscriptions…). "Don't recommend channel"
  was built and then removed at the owner's request (see ROADMAP).
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

## Verifying changes as an agent

The built-in browser pane **cannot load extensions**. Use these instead:

1. **Live harness:** `npm run build && node scripts/harness.mjs` produces `dist-test/harness.js` (an
   in-memory `chrome.*` shim + sw + bridge + content). YouTube's CSP and local-network rules block
   fetching it from localhost, so **paste the file's contents into the JS tool**. That evaluation bypasses
   the CSP. Seed storage first with `window.__BOTLESS_SEED__ = { overrides: {...}, settings: {...} }`.
   The scripts survive SPA navigation. To navigate in-app without a reload:
   ```js
   document.querySelector('ytd-app').dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true,
     detail: { endpoint: { commandMetadata: { webCommandMetadata: { url: '/watch?v=ID', webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } }, watchEndpoint: { videoId: 'ID' } } } }));
   ```
2. **Popup / options previews:** `node scripts/previews.mjs`, then start the `harness` launch config
   (`.claude/launch.json`, port 8123) and open `http://localhost:8123/dist-test/popup.html` or
   `options.html`. Opening them via `file://` doesn't work: the pane loads them as `data:` snapshots, so
   relative scripts break.
3. **Hidden-pane pitfalls:** when the pane isn't displayed, `document.hidden` is true. Then
   `requestAnimationFrame` doesn't run (Botless applies badges in rAF), YouTube doesn't lay out menus or
   the Shorts overlay, and screenshots time out or show stale frames. Check the DOM with JS instead, or
   ask the owner to test in real Chrome (docs/TESTING.md).
4. The agent can't open `accounts.google.com`. The owner signed into YouTube in the pane themselves once;
   anything there is their real account, so read only, and ask before any action.

## Shell pitfalls (Windows, Git Bash + PowerShell 5.1)

- Bash heredocs containing JS template literals (backticks, `${}`) have been truncated silently. Write
  files with the editor tool, or run `node -` scripts that use plain string replacements. Check the
  result with `grep`.
- Renaming or deleting the working directory fails while a session (or its hidden terminal) has it as
  cwd.
