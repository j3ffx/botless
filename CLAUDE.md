# Botless for YouTube — contributor notes

MV3 Chrome extension (TypeScript 7, esbuild, vitest; no framework). Read first:

- `README.md` covers what it does, the verdict model, permissions, privacy and architecture.
- `docs/YOUTUBE-DOM.md` covers every YouTube selector and data path, verified live, with dates.
- `docs/TESTING.md` is the manual test plan, with real test video IDs.
- `docs/ROADMAP.md` lists decisions already made (with reasons), removed features, and open items.

## Commands

```bash
npm run build        # -> dist/ (load unpacked in Chrome)
npm run typecheck    # tsc --noEmit
npm test             # vitest: unit tests + tests/invariants.test.ts (the invariants below)
npm run verify       # all of the above + check:dist (what's shipped: files, no eval/source maps, size budget)
npm run smoke        # dist/ in real Chrome, offline (needs CHROME_PATH, see below)
```

Run `npm run verify` before every commit. `npm install` also points git at `.githooks/`, whose
`commit-msg` hook rejects messages that don't follow the rules below.

The smoke test needs Chrome for Testing (branded Chrome ignores `--load-extension`):
`npx @puppeteer/browsers install chrome@stable`, then set `CHROME_PATH` to the path it prints.

## Commits

Follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) strictly:

```
type(scope)!: imperative description, lowercase, no trailing period

Body explaining *why* (the diff already shows what).

BREAKING CHANGE: … (when relevant)
```

- **Types:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`, `revert`.
- **Scope** is optional. When you use one, name the area: `popup`, `options`, `content`, `bridge`, `sw`,
  `checker`, `scoring`, `shared`, `manifest`, `docs` (plus `deps`, `deps-dev`, `release` for tooling).
  `scripts/check-commits.mjs` holds the authoritative list and is what CI and the hook enforce.
- Keep the header to 72 characters or fewer. Mark breaking changes with `!` and/or a `BREAKING CHANGE:`
  footer.
- Keep commits small and logical, one type per commit. If a change needs two types, split it into two
  commits.
- Pull requests are **squash-merged**: the PR title becomes the commit on `main`, so it follows the same
  rules (checked by `.github/workflows/pr-title.yml`).
- Commits before `ce9d981` predate this rule. Don't rewrite them.

## CI and releases

- **CI** (`.github/workflows/ci.yml`) runs on every push to `main` and every PR: typecheck, tests, build,
  `check:dist`, the Chrome smoke test on the exact built files, and the commit-message check. The built
  extension is kept 14 days as the `botless-dist` artifact (unzip it, then load it unpacked).
- **Release:** `npm version patch|minor|major` re-runs `verify`, bumps `package.json` *and*
  `manifest.json`, commits `chore(release): X.Y.Z` and tags `vX.Y.Z`. Then
  `git push --follow-tags`. The tag runs `.github/workflows/release.yml`: full CI again, then a GitHub
  Release with `botless-X.Y.Z.zip` (the file to upload to the Chrome Web Store) and notes grouped by
  commit type. Chrome only accepts plain `X.Y.Z` versions: no `-beta` suffixes. Run the Release workflow
  by hand for a dry run that publishes nothing.
- `npm run release-notes` previews the notes of the next release.
- **Project site:** `site/` is published to https://j3ffx.github.io/botless/ by `.github/workflows/pages.yml`, with
  `privacy.html` filled in from `PRIVACY.md` (`scripts/build-site.mjs`). Never delete
  `site/google*.html`: it's the Google Search Console ownership file that keeps the site verified as the
  store listing's Official URL.
- **Dependabot** opens grouped weekly PRs for npm and monthly ones for Actions, 7 days after a release
  (security fixes immediately). Actions are pinned to commit SHAs.
- **Chrome:** required CI pins a Chrome for Testing build (`CHROME_VERSION` in `ci.yml`). The weekly
  `chrome-latest.yml` runs the smoke test on the newest Chrome and says when to move the pin. It never
  blocks a merge.

## Invariants (discuss before changing)

`tests/invariants.test.ts` and the smoke test enforce most of these in CI. If you change one on purpose,
discuss it first, then update the test in the same commit.

- **Privacy.** With "Active mode" off (the default), Botless makes no requests of its own. The only `fetch`
  calls live in `src/content/checker.ts`, go to `www.youtube.com` with `credentials: "omit"`, and are
  rate-limited by the service worker (`checkPermit`). The service worker and the MAIN-world bridge never
  fetch. Storing or sending anything new means updating `PRIVACY.md` and `docs/STORE.md` in the same commit.
- **Never act on the user's YouTube account** (feedback, likes, subscriptions…). A "Don't recommend
  channel" feature was built and then removed (see ROADMAP).
- **Popup: at most two switches:** Botless on/off, and Active mode. Anything else goes in Settings.
- The UI never claims certainty: "Probably AI / Probably Human / Inconclusive".
- Pure logic stays in `src/shared/*` (no DOM, no `chrome.*`; `messages.ts` and `storage.ts` are the only
  `chrome.*` wrappers there) with unit tests. The scoring weights live only in `src/shared/scoring.ts`.
- The service worker is the single writer for channel data (`serial()` queue). Content scripts read
  storage and message the service worker.
- MAIN-world `src/bridge/bridge.ts`: no `chrome.*`, no storage, no network. It passes data to the isolated
  world only via `data-botless-*` attributes and JSON-**string** CustomEvents (`botless:page`,
  `botless:scan`, `botless:request-page`).
- Only trust `browseEndpoint.browseId` for channel IDs, never a `/UC.{22}/` regex (tracking params match
  it).
- **The page is untrusted.** Any script in YouTube's page can forge `botless:*` events and `data-botless-*`
  attributes. Validate whatever crosses from the page or arrives as a message with `src/shared/validate.ts`.
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
