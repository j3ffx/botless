# Store images and promo video

Everything the Chrome Web Store listing and the YouTube demo use is generated here, with code. Paste-ready
listing texts are in [`docs/STORE.md`](../docs/STORE.md).

All three steps need `CHROME_PATH` (Chrome for Testing, see CLAUDE.md) and `npm install`.

## 1. Capture real YouTube (`capture.mjs`)

Real screenshots show other creators' videos, so `store/captures/` is git-ignored: recapture when they're
needed. Build first (`npm run build`), don't use a VPN (YouTube's robot check), and stay signed out.

```bash
node store/capture.mjs launch                                   # a visible Chrome window, Botless loaded
node store/capture.mjs search "ai generated short film" 120     # Active mode finds labeled channels
node store/capture.mjs modes "ai generated short film" 1390     # scrollY of the candidate you picked
node store/capture.mjs watch gcZwE5cM4xs                        # a labeled video, for the watch page
node store/capture.mjs close
```

**Pick candidates by hand.** Reject any view that shows:

- a real person's likeness (celebrities, politicians) or a franchise character;
- an ad or "Sponsored" item (the screenshots crop the bottom 136 px, the video the top and bottom ~40 px);
- a location hint ("Popular in …", a country code next to the logo);
- a creator being labeled "Probably AI" without YouTube's own label: Botless only flags labeled videos, so
  this can't happen unless thresholds were changed. Captures use the default thresholds.

The popup and Settings images use the previews' fake data (`scripts/previews.mjs`, a made-up channel).

## 2. Render the images (`render.mjs`)

```bash
node store/render.mjs
```

Writes `store/out/`: `screenshot-1…5` (1280×800), `promo-small-440x280.png`, `promo-marquee-1400x560.png`,
`youtube-thumbnail.png` (1280×720) and `store-icon-128.png`. Captions live in `render.mjs` and the pages in
`store/pages/`.

## 3. Record the video (`video.mjs`)

```bash
node store/video.mjs
```

`store/pages/video.html` is a canvas animation (scene list at the top) and `store/pages/soundtrack.js` a
Web Audio soundtrack scheduled on the same clock, recorded together by Chrome's MediaRecorder into
`store/out/botless-promo.webm` (VP9 + Opus, 1280×720, about 44 s). The script then plays it back and checks
the duration, clipping and silent stretches. The file has no seek index: it plays fine (and YouTube accepts
it), but jumping around in a local player may not work.

The video goes on the Botless YouTube channel (the project's own account, never a personal one), Unlisted,
with `youtube-thumbnail.png`. Check its owner before using the link:
`https://www.youtube.com/oembed?url=<video URL>&format=json` → `author_url`.
