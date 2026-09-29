# Roadmap, decisions and open ideas

Read this before proposing features: several obvious ideas have already been tried, and some were
rejected on purpose.

## Decisions (with the reason, so they aren't re-litigated)

| Date | Decision | Why |
|---|---|---|
| 2026-09-28 | Judge the **channel**. A video that itself carries YouTube's AI label is also AI on its own tile or page, but that doesn't change the channel verdict. | Spec: channel verdicts. The per-video rule was added because AI Shorts polluted feeds while their channels were still unjudged. |
| 2026-09-28 | Auto-dubbed videos (`answer/15569972`) never count as AI. | They share the "How this was made" section. Counting them would flag many ordinary channels (4 of 5 in one sample). |
| 2026-09-28 | Match the label by help-article ID first, text second. | Language independent. Verified with a French YouTube UI. |
| 2026-09-28 | Don't use the YouTube Data API. | Needs a key, network and permissions. The page already has the label (`docs/YOUTUBE-DOM.md` §4). |
| 2026-09-28 | Background checks go to youtube.com only, **without cookies**, 3 s apart (fixed), with a daily limit (setting, default 150). | Cookieless requests can't touch the account or history. Request *rate* is what bot detection reacts to, so the spacing isn't user-tunable. 150 is a cautious guess: YouTube publishes no limit. |
| 2026-09-28 | One labeled video never makes a channel "Probably AI" (needs 2 of 2 by default). Checks confirm a first label with one more video from the channel's RSS feed. | The newest We R Cinephiles Short had no label although others did. |
| 2026-09-29 | The popup has **at most 2 switches**: Botless on/off, and **Active mode**. Finer options live in Settings. | Keeps the popup simple: one switch for "on", one for "may talk to YouTube". |
| 2026-09-29 | The second switch is named **"Active mode"**, off by default. Off = fully local, no requests of its own. | Clearer than the earlier "Connect to YouTube". Off by default for privacy. |
| 2026-09-29 | **Removed** "Don't recommend channel" / "Not interested" (acting through YouTube's ⋮ menu, with buttons and an auto mode). | It acted regardless of the display mode and wasn't reliable in real use. "Hide completely" covers the need. **Don't reintroduce actions on the user's YouTube account without discussing it first.** Research kept in `docs/YOUTUBE-DOM.md` §6. |
| 2026-09-29 | Commits follow **Conventional Commits**, enforced by a git hook and CI. | Readable history, and release notes can be generated from it. |
| 2026-09-29 | Releases are **tag-driven** (`npm version` + `git push --follow-tags`), not release-please. | Works with direct pushes to `main`, and needs no extra repo settings (release-please needs Actions allowed to open PRs). |
| 2026-09-29 | CI tooling is **zero-dependency Node scripts** (zip, commit lint, notes). The only new dev dependency is `puppeteer-core`, for the smoke test. | Fewer packages to audit for a privacy-focused extension. |
| 2026-09-29 | The smoke test runs in **Chrome for Testing**, fully offline (every request is intercepted), and fails on any request while Active mode is off. | Branded Chrome ignores `--load-extension` since v137. Offline keeps CI deterministic and never touches real YouTube. |

## Open items

- **Phase 2 is unspecified.** The original spec was cut off at "Phase 2 (only after phase 1". Hooks exist
  for community votes (README → Phase 2 hooks). Agree on a spec before building it.
- **Publishing.** Not on the Chrome Web Store yet. That needs a developer account, store listing and
  screenshots, and a privacy statement matching README → Privacy (EU "trader" rules apply if published
  commercially).
- **Icon.** The generated split-circle icon (`scripts/make-icons.mjs`) predates the rename to Botless and
  could be redesigned.
- **Unverified:** the localized label *text* fallback (the article-ID match covers it in practice), and
  `m.youtube.com` / YouTube Music (unsupported).

## Ideas discussed, not built

Ranked by how they were assessed:

1. **Upload-pattern signal** (AI farms: many near-identical uploads a day, or a new channel with hundreds of
   videos). Useful, but news and clip channels behave the same way, so only as a weak, optional signal.
2. **Keyword hints** ("Suno", "Udio", "#aimusic", "AI generated" in titles and descriptions). Weak,
   optional.
3. **Shared data / community votes** (phase 2). This is the real fix for the cold start, but it needs a
   server, a privacy notice and consent.
4. **Other browsers.** Edge, Brave and Opera can use the same build. Firefox needs a small port. The
   mobile web (`m.youtube.com`, `ytm-*` markup) needs new selectors.
5. **YouTube app.** It can't be modified by an extension. The only realistic route is a share-sheet
   companion app ("Share → Botless" shows the channel verdict), and that needs phase-2 shared data first.
   Modded clients (ReVanced etc.) were rejected: terms of service, and they can't be published.
