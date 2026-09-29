# Botless for YouTube

[![CI](https://github.com/j3ffx/botless/actions/workflows/ci.yml/badge.svg)](https://github.com/j3ffx/botless/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)

A Manifest V3 Chrome extension that judges each **channel** as **Probably Human**, **Probably AI** or
**Inconclusive**, then badges, fades, hides or auto-skips that channel's videos.

Phase 1 runs **on your device**. It has no analytics and no servers. The popup has two switches:
**Botless on/off**, and **[Active mode](#active-mode-opt-in)**. The second one is off by
default. While it's off, Botless is fully local and makes no requests of its own; it learns only from
what you watch.

## Install

Botless isn't on the Chrome Web Store yet. Until then:

1. Download `botless-X.Y.Z.zip` from the [latest release](https://github.com/j3ffx/botless/releases/latest)
   and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.
4. Reload any YouTube tabs that were already open.

To build it yourself instead, run `npm install && npm run build` and load the `dist/` folder.

Requires Chrome 111+ (for `"world": "MAIN"` content scripts).

## How a verdict is made

The verdict belongs to the channel, not to a single video. The scoring lives in one pure module,
[`src/shared/scoring.ts`](src/shared/scoring.ts), which has no DOM and no `chrome.*` calls and is fully
unit tested. Each signal adds to a score between −1 and +1:

| # | Signal | Contribution | Notes |
|---|---|---|---|
| 1 | **Your manual mark** | decides the verdict | Always wins, and only for you. |
| 2 | **Official label ratio**: share of the channel's videos *you've watched* that carry YouTube's own "Made with AI" disclosure | **+1.0** if ratio ≥ 90% (configurable) and at least 2 videos seen | Strongest automatic signal. Enough for "Probably AI" by itself. |
| 2b | Some labeled videos, but below the ratio or sample size | +0.3 + 0.3 × ratio (max 0.6) | Never enough for "Probably AI" alone. A creator who used AI once is not an AI channel. |
| 3 | No labels across 5+ watched videos | −0.5 | Weak evidence, because many creators never disclose. |
| 4 | **Community votes** (phase 2) | ±0.8 × (ai − human) / total | Ignored until there are 5+ votes. |

Mapping: score ≥ 0.7 → **Probably AI**; score ≤ −0.3 → **Probably Human**; any other score where a signal
fired → **Inconclusive**; no signal → no badge. The UI never claims certainty.

Every threshold can be changed on the options page. The internal weights are in `WEIGHTS` at the top of
`scoring.ts`, and `tests/scoring.test.ts` pins down the intended behaviour of each rule.

### What counts as "YouTube's AI label"

YouTube currently shows **"How this was made → Made with AI"** in the description. The older wording was
"Altered or synthetic content". The same section is **also used for "Auto-dubbed"**, which is YouTube's
own translation dubbing, not a creator disclosure. Auto-dubbed videos are deliberately **not** counted.
Matching uses the help-center article ID in the "Learn more" link, so it works in any UI language. The
full findings, with real data samples, are in [`docs/YOUTUBE-DOM.md`](docs/YOUTUBE-DOM.md).

### The disclosure is read only on pages you open

The label appears on the watch page, not on thumbnails. A channel's ratio therefore builds up from the
videos **you** watch. A brand-new channel shows nothing until you've watched at least one of its videos,
or until you mark it yourself. Turn on **Active mode** to fill this gap sooner.

**A labeled video is AI content, even if its channel isn't judged yet.** When a video itself carries
YouTube's AI label, that one video is treated as *Probably AI*: badge, fade or hide on its tile, and
auto-skip when it plays. This matters most for Shorts. The channel's verdict isn't changed by one video,
and your own "human" mark on a channel still wins.

## Active mode (opt-in)

This is the second switch in the popup, off by default. It turns on **background checks** (below), which
are the only thing in Botless that sends requests of its own. You can fine-tune them in Settings → Active
mode (checks on/off, daily limit).

Turn it off and Botless goes back to being fully local: it's less informed, but it doesn't talk to anyone.
Botless never acts on your YouTube account (no "Don't recommend", no "Not interested"). To keep AI videos
out of sight, set *Probably AI* to **Hide completely**.

### Background checks

Botless looks up YouTube's AI label for videos whose thumbnails are on your screen, before you watch
anything:

1. It checks the video on the tile, using YouTube's own `/youtubei/v1/next` endpoint (the same data a
   watch page loads). This also works for **Shorts tiles**, which don't show their channel: the response
   reveals it, and Botless remembers which channel the Short belongs to.
2. If that video carries the label, it reads the channel's public feed (`/feeds/videos.xml`, about
   22 KB) and checks one more recent video. Two of two labeled gives **Probably AI**. One label alone
   only gives Inconclusive.

Results count exactly like videos you watched. The limits:

- **youtube.com only, with no cookies** (`credentials: "omit"`). The requests aren't tied to your account,
  so they can't affect your watch history or recommendations.
- **Slow on purpose:** one request at a time, at least 3 seconds apart across all tabs. The spacing is
  fixed, because request rate is what bot detection reacts to. The daily total is a setting: 150 by
  default (roughly 50–150 channels), adjustable from 10 to 1000 in Settings. That default is a cautious
  guess, since YouTube publishes no limit. If YouTube answers 429/403/5xx, checks pause for 15 minutes.
- Only on-screen tiles, only channels with no data yet (or Shorts whose channel is unknown), never channels
  you marked, and never in background tabs.

Code: [`src/content/checker.ts`](src/content/checker.ts) (scheduling),
[`src/shared/check.ts`](src/shared/check.ts) (parsing, pure), and `checkPermit` in the service worker
(the global rate limit). The endpoints are documented in
[`docs/YOUTUBE-DOM.md`](docs/YOUTUBE-DOM.md#5-endpoints-used-by-background-checks-opt-in).

## Features

- **Feed, search, sidebar, Shorts shelves:** a small badge on thumbnails (red *Probably AI*, grey
  *Inconclusive*, optional green *Probably Human*). A video or Short that itself carries the AI label is
  *Probably AI* on its own.
- **Action per verdict:** badge only, fade, or hide completely.
- **Watch page and Shorts:** a pill next to the channel name. With auto-skip on, a *Probably AI* video
  is paused and a toast ("Skipping likely-AI video — Undo") counts down 3 seconds (configurable). Then it
  goes to the next video (or back, per your setting). **Undo** resumes playback and won't skip that
  video again in this tab.
- **Popup:** exactly two switches (Botless on/off, Active mode, with today's check usage), today's
  count of flagged videos, the current channel's verdict and the reasons behind it, and Mark as AI / Mark
  as human. The community vote buttons are shown but disabled until phase 2.
- **Options:** general (auto-skip), Active mode (background checks and their daily limit; greyed out
  while the gate is off), actions, thresholds, cache lifetimes, the list of channels
  you marked (with Remove), and JSON export/import. Imports are validated field by field.
- Works with YouTube's light and dark themes (`html[dark]`). The popup and options pages follow
  `prefers-color-scheme`.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Saves settings, your marks, per-channel observations and the verdict cache in `chrome.storage.local`, on your device only. |
| `host_permissions: https://www.youtube.com/*` | Runs the content scripts on YouTube, and lets the popup see that the active tab is a YouTube page so it can ask that tab which channel is showing. With Active mode on, it is also the only host Botless's own requests go to. |

That is all. No `tabs`, `scripting`, `webRequest`, `downloads`, `alarms` or other permissions. Export
uses a normal `<a download>` link. Old channels are purged when the browser starts, so `alarms` isn't
needed.

### Why there is a MAIN-world script

Channel IDs (`UC…`) exist only in YouTube's own JavaScript objects. The visible links show `@handles`,
which owners can change. A normal content script can't read page JavaScript. So
[`src/bridge/bridge.ts`](src/bridge/bridge.ts) runs inside the page and does only two things: it copies IDs
into `data-botless-*` attributes, and it reports the current page's video, channel and disclosure through a
DOM event. It can't access
`chrome.*`, doesn't touch storage, and makes no requests. Because it runs in the page, YouTube's own
scripts could in principle see those attributes and events. They only contain facts YouTube already has
(which video is on screen). **Your verdicts and marks never enter the page context.**

## Privacy

- By default Botless makes **no network requests** of its own. The only `fetch` calls are in
  `src/content/checker.ts`, and they run only while **Active mode** is on. They go to
  `www.youtube.com` only, without cookies. There is no remote code and no analytics. You can check with
  `grep -rnE "fetch\(|XMLHttpRequest|WebSocket" src/`.
- Everything is stored in `chrome.storage.local`:

  | Key | Contents | Lifetime |
  |---|---|---|
  | `settings` | your preferences | until changed |
  | `overrides` | channels you marked AI/Human | forever (remove in Options) |
  | `c:<channelId>` | video IDs you watched from that channel + label yes/no (last 200), cached verdict | cache re-checked after 7 days; channel forgotten after 180 days unseen |
  | `vmap` | video → channel pairs, used to badge channel-less Shorts tiles | newest 3000 |
  | `stats` | today's flagged video IDs, for the counter | reset daily |
  | `checks` | number of background checks today, plus any pause | reset daily |

- **Clear observations** in Options wipes everything except your settings and marks.

## YouTube Data API

The API has `videos.status.containsSyntheticMedia`. It is documented as the owner-side disclosure field,
and we did not verify that it can be read on other people's videos. **It is not used**: it would need
network calls, an API key and an extra permission, which conflicts with phase 1's no-data rule, and the
watch page already has the same information. Details are in
[`docs/YOUTUBE-DOM.md`](docs/YOUTUBE-DOM.md#4-youtube-data-api-v3).

## Architecture

```
src/
  bridge/bridge.ts        MAIN world: stamps data-botless-vid/cid on tiles; emits `botless:page` (video, channel, disclosure)
  content/index.ts        isolated world: reads stamps, looks up verdicts, applies badge/fade/hide, pill, auto-skip
  content/badges.ts       thumbnail badge + fade/hide
  content/watch.ts        owner pill, toast, Undo, skip
  content/checker.ts      opt-in background checks: queue + fetch (youtube.com, no cookies)
  background/sw.ts        service worker: the single, serialized writer for all storage + global check rate limit
  popup/, options/        vanilla TS UI (no framework needed at this size)
  shared/scoring.ts       ★ pure verdict model
  shared/verdict.ts       cache/TTL + observation bookkeeping (pure)
  shared/disclosure.ts    official-label detection (pure; JSON or DOM)
  shared/extract.ts       channel/video ID extraction (pure)
  shared/backup.ts        export/import validation (pure)
  shared/check.ts         background-check parsing + "what does this channel need next" (pure)
```

**Performance.** The MutationObserver callback only sets a flag. Work runs at most every ~150 ms via
`requestIdleCallback`. Each pass compares one `href` per tile and skips tiles that haven't changed, and
DOM writes are batched in `requestAnimationFrame`. Nothing runs in hidden tabs. Storage writes go through
the service worker in batches of up to 2 seconds. The bundles are about 46 KB in total, minified.

## Development

```bash
npm run build       # production build -> dist/
npm run watch       # rebuild on change (with inline source maps)
npm test            # vitest: scoring, disclosure, extraction, cache/TTL, checks, settings, import,
                    # orphaned-script, commit lint, and the project invariants (privacy, purity, manifest)
npm run typecheck
npm run verify      # typecheck + tests + build + dist/ check: run before every commit
npm run smoke       # loads dist/ in Chrome for Testing, offline (needs CHROME_PATH)
npm run package     # dist/ -> botless-<version>.zip (store upload)
npm run icons       # regenerate PNG icons
```

CI runs all of this on every push and pull request. Releases are cut with `npm version` and published
from the tag by GitHub Actions. Details are in `CLAUDE.md` → CI and releases.

Dev-only helpers (not shipped):

- `node scripts/harness.mjs` bundles the built scripts with an in-memory `chrome.*` shim into
  `dist-test/harness.js`. Paste it into a YouTube tab's DevTools console to try the extension without
  installing it. This is how the live smoke tests below were run.
- `node scripts/previews.mjs` generates popup, options and injected-UI previews with fake data in
  `dist-test/`. Serve them with `node scripts/serve-harness.mjs` and open
  `http://localhost:8123/dist-test/popup.html`.

### Verified on live YouTube (2026-09-28)

- Search tiles (`ytd-video-renderer`) stamped with the correct UC IDs, and badges rendered.
- Shorts shelf tiles stamped with a video ID and no channel, as expected.
- Watch page for a real "Made with AI" video: disclosure read from data, channel observed, the
  *Inconclusive* pill at 1 video, and *Probably AI* after lowering the minimum to 1.
- Auto-skip toast, video paused during the countdown, skip after the delay, Undo keeps the video and
  isn't re-triggered, and the daily counter increments.
- Shorts player: channel ID and disclosure detected from the `yt-navigate-finish` data.
- Everything above, plus the Shorts overlay pill, auto-skip to the next video in a playlist (signed
  in), "Latest Shorts from X" badging, background checks, the popup and Settings, both themes and
  scrolling performance, was then confirmed manually in real Chrome, signed in, with YouTube in
  French. The full manual test plan is in [`docs/TESTING.md`](docs/TESTING.md).

## Known limitations

- Desktop `www.youtube.com` only (not `m.youtube.com`, not YouTube Music).
- Verdicts reflect what you have watched. That is local and private, but it starts empty.
- Shorts tiles carry no channel data. They are badged on the channel's own page, in search "Latest
  Shorts from X" shelves, when the video was already seen elsewhere, or once a background check
  (Active mode) has looked the Short up. Without Active mode, mixed Shorts shelves stay unbadged.
- Detection works with a French YouTube UI (verified manually). That's thanks to the
  language-independent help-article-ID match; the localized header *text* fallback itself remains
  unverified.
- YouTube markup changes. All selectors are listed in `docs/YOUTUBE-DOM.md` and kept in a few constants
  (`TILE_SELECTOR`, `THUMB`, `ITEM_ROOT`, `OWNER_TARGET`).

## Phase 2 hooks

Phase 2 isn't specified yet. It's expected to add community votes, and it will be designed and documented
before anything is built. See [`docs/ROADMAP.md`](docs/ROADMAP.md). What's already in place:

- `computeVerdict` already accepts `votes` and applies `minVotes` / `voteWeight`. Both are covered by
  tests and exposed in Options.
- `ChannelRecord.votes` exists in the storage schema.
- The service worker has a `vote` message that currently returns "phase 2". A vote client would plug
  in there.
- The popup has the vote buttons in place, disabled.

A backend would also need the `host_permissions` entry for its origin, a privacy notice update, and
opt-in consent.

## License

Copyright (C) 2026 j3ffx. Botless is free software, licensed under the
[GNU General Public License v3.0](LICENSE): you can use, study, share and modify it, and anything you
distribute that's based on it must be released under the same license, with its source.

Botless is an independent project. It is not affiliated with, endorsed by or sponsored by YouTube or
Google. YouTube is a trademark of Google LLC.
