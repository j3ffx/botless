# Manual test plan

The extension can only be fully tested in a **real Chrome** with the unpacked build loaded. Automated tests
(`npm test`) cover the pure logic. Selectors and flows need YouTube itself.

The owner runs this plan in their own Chrome, **signed in, with YouTube's UI in French**. All steps passed on
2026-09-28/29. Rerun the relevant steps after any change to the bridge, the content script or the selectors.

## Setup

```bash
npm install && npm run build
```

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → `dist/`.
2. Pin the Botless icon (puzzle-piece menu).
3. After **every** rebuild: click ↻ on Botless, then **refresh YouTube tabs**. Tabs left open keep running the
   old, disconnected copy. It now shuts itself down quietly (see `alive()` in `src/content/index.ts`), but it
   does nothing until the tab is refreshed.

## Known test videos

These are real videos, checked on 2026-09-28. They can disappear or change labels over time.

| ID | Channel | What it's for |
|---|---|---|
| `ZneqyXsgpO4` | We R Cinephiles (`UCZy_1WNgqZXMqrYeKoX-n1A`) | Has YouTube's **"Made with AI"** label. It's a Short, so it also plays at `/watch`. |
| `TCp_fT90F5s` | We R Cinephiles | Newest Short of that channel, **no** label. Shows why one label alone must not mean "Probably AI". |
| `LKQMw1WGL78` | KEEMOKAZI (`UCMOLiZpKXp-w5CNfqJObQUw`) | **Auto-dubbed** only. Must **not** count as AI. |
| `JsBZOcqZerk`, `NIk_0AW5hFU`, `J1WoNuemKOg` | Veritasium (`UCHnyfMqiRRG1u-2MsSQLbXA`) | Ordinary, unlabeled videos. Handy for "mark as AI" tests. |

Search `We R Cinephiles` for a "Latest Shorts from X" shelf. Their Shorts tab is `/@WeRCinephiles/shorts`.

## Steps

1. **First look.** The popup shows "0 likely-AI videos flagged today" and "Open a YouTube video…".
2. **Official label.** Open `watch?v=ZneqyXsgpO4`. The description has "How this was made → Made with AI".
   Expect an **Inconclusive** pill next to the channel name, with the reason "1 of 1 video… need 2+ videos"
   in the popup. It turns **Probably AI** after a second labeled video, or right away if Settings → minimum
   videos is set to 1.
3. **Auto-dubbed.** `watch?v=LKQMw1WGL78` must get no AI verdict.
4. **Manual mark.** Popup → Mark as AI on a known channel. Its tiles get red badges in search, on home and
   in the sidebar, without a reload. Mark as human and Clear also update live.
5. **Actions.** Settings → Probably AI → Fade, then Hide completely. Hidden tiles collapse, with no gaps
   in the grid.
6. **Auto-skip and Undo.** Turn auto-skip on and open a video from a channel marked AI. The video pauses, a
   toast counts down, then it moves on. Undo keeps the video, and it isn't re-skipped in that tab.
   *Next video*: use a throwaway playlist,
   `https://www.youtube.com/watch_videos?video_ids=ZneqyXsgpO4,JsBZOcqZerk,NIk_0AW5hFU`. It should skip to
   item 2. YouTube's own "next" shortcut is **Shift+N**. If there's no next video, it goes back.
7. **Shorts.**
   a. `/shorts/ZneqyXsgpO4` shows the pill in the channel bar.
   b. Swiping away removes it, and swiping back restores it.
   c. Auto-skip moves to the next Short (Undo works).
   d. In search, the "Latest Shorts from We R Cinephiles" shelf is badged, and so is `/@WeRCinephiles/shorts`.
8. **Popup and Settings.** The counter increments once per video. The on/off switch removes and restores
   everything. Marked channels are listed with Remove. The human → "Subtle green badge" option works.
   Export → Clear observations → Import restores observations. Out-of-range numbers get clamped.
9. **Themes.** YouTube light and dark (profile → Appearance): badge, pill and toast are all readable.
10. **Performance.** Scroll home fast for about 30 s. No stutter, and no badge stays stuck on a recycled tile.
11. **Privacy.** `chrome://extensions` → Botless → Details → *service worker* → Network tab. It stays
    empty (the SW never fetches). With **Active mode** off, the YouTube tab also shows no Botless requests.

### Active mode (background checks)

- The popup has exactly **two switches**: Botless, and Active mode.
- With Active mode on, search `ai generated music` and wait. The popup's "N of 150 checks today" rises by
  about 1 every 3 s, and badges appear without opening videos. Channel-less Shorts get badged too.
- `youtube.com/feed/history` shows none of the checked videos (requests are sent without cookies).
- Turning Active mode off stops the counter.

## Agent-side verification (no real Chrome)

A coding agent can't load the extension in the built-in browser pane. See `CLAUDE.md` → *Verifying changes*
for the harness and preview workflow and its pitfalls.
