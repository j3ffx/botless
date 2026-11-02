# Roadmap, decisions and open ideas

Read this before proposing features: several obvious ideas have already been tried, and some were
rejected on purpose.

Botless is [on the Chrome Web Store](https://chromewebstore.google.com/detail/botless-for-youtube/dcjchknlcighdakohbpgnmmhfpibnjne).
Updates go through `CLAUDE.md` → CI and releases.

## Decisions (with the reason, so they aren't re-litigated)

| Date | Decision | Why |
|---|---|---|
| 2026-09-28 | Judge the **channel**. A video that itself carries YouTube's AI label is also AI on its own tile or page, but that doesn't change the channel verdict. | Spec: channel verdicts. The per-video rule was added because AI Shorts polluted feeds while their channels were still unjudged. |
| 2026-09-28 | Auto-dubbed videos (`answer/15569972`) never count as AI. | They share the "How this was made" section. Counting them would flag many ordinary channels (4 of 5 in one sample). |
| 2026-09-28 | Match the label by help-article ID first, text second. | Language independent. Verified with a non-English YouTube UI. |
| 2026-09-28 | Don't use the YouTube Data API. | Needs a key, network and permissions. The page already has the label (`docs/YOUTUBE-DOM.md` §4). |
| 2026-09-28 | Background checks go to youtube.com only, **without cookies**, 3 s apart (fixed), with a daily limit (setting, default 150). | Cookieless requests can't touch the account or history. Request *rate* is what bot detection reacts to, so the spacing isn't user-tunable. 150 is a cautious guess: YouTube publishes no limit. |
| 2026-09-28 | One labeled video never makes a channel "Probably AI" (needs 2 of 2 by default). Checks confirm a first label with one more video from the channel's RSS feed. | The newest We R Cinephiles Short had no label although others did. |
| 2026-09-29 | The popup has **at most 2 switches**: Botless on/off, and **Active mode**. Finer options live in Settings. | Keeps the popup simple: one switch for "on", one for "may talk to YouTube". |
| 2026-09-29 | The second switch is named **"Active mode"**, off by default. Off = fully local, no requests of its own. | Clearer than the earlier "Connect to YouTube". Off by default for privacy. |
| 2026-09-29 | **Removed** "Don't recommend channel" / "Not interested" (acting through YouTube's ⋮ menu, with buttons and an auto mode). | It acted regardless of the display mode and wasn't reliable in real use. "Hide completely" covers the need. **Don't reintroduce actions on the user's YouTube account without discussing it first.** Research kept in `docs/YOUTUBE-DOM.md` §6. |
| 2026-09-29 | Commits follow **Conventional Commits**, enforced by a git hook and CI. | Readable history, and release notes can be generated from it. |
| 2026-09-29 | Releases are **tag-driven** (`npm version` + `git push --follow-tags`), not release-please. | Works with direct pushes to `main`, and needs no extra repo settings (release-please needs Actions allowed to open PRs). |
| 2026-09-29 | CI tooling is **zero-dependency Node scripts** (zip, commit lint, notes). The only new dev dependencies are `puppeteer-core` (smoke test) and `oxc-parser` (invariant tests). | Fewer packages to audit for a privacy-focused extension. |
| 2026-09-29 | **TypeScript 7** (native compiler) for type checking. `tests/invariants.test.ts` parses with `oxc-parser`, not TypeScript's API. | TS 7 is ~7x faster here and only ships an `unstable/` API. oxc outputs standard ESTree, so the tests don't depend on TypeScript internals. |
| 2026-09-29 | The smoke test runs in **Chrome for Testing**, fully offline: requests from the YouTube tab, the popup and Settings are intercepted, and it fails on any request while Active mode is off or on any page loading something from outside the extension. The service worker has no network code at all, which the static checks enforce (tests/invariants.test.ts, scripts/check-dist.mjs). | Branded Chrome ignores `--load-extension` since v137. Offline keeps CI deterministic and never touches real YouTube. |
| 2026-09-30 | The phase 2 **vote controls are hidden** from the popup and Settings. The hooks stay in the code. | Phase 2 has no spec: the store listing shouldn't promise a feature that may never ship. |
| 2026-09-30 | The icon stays the **split circle** (half red "AI", half white ring "human"), resized to the store's 96 px artwork. | Picked from four designs (also a crossed-out bot, a shield and a "B" monogram). |
| 2026-10-01 | A failed **channel feed only skips that confirmation**. Only 429 and 403 from it pause the checks. | YouTube's RSS feeds go down on their own (404 or 5xx for channels that exist). That says nothing about Botless's request rate. |
| 2026-10-01 | Releases are tested on **live YouTube** by hand (`npm run live-test`), never in CI. | The offline smoke test can't see YouTube itself; the live test found real bugs it missed. In CI, it would hit YouTube from shared IPs on every push. |
| 2026-10-01 | The project site loads **nothing from other sites**; the demo video only loads when clicked, from `youtube-nocookie.com`. | Same privacy stance as the extension. |
| 2026-10-05 | A **welcome page** opens once, on first install. Static HTML, no script. | Verdicts need a few watched videos, so a new user saw nothing happen and could think Botless was broken. Google also ranks listings partly on onboarding. |
| 2026-10-05 | Store uploads run from a **workflow with no stored key** (`store.yml`: GitHub's OIDC token for a short-lived Google token). | Nothing to leak, and Google only accepts tokens from that workflow on `main`. |

## Open items

- **Phase 2 is unspecified.** It's expected to add community votes. Agree on a spec before building it.
  What's already in place:
  - `computeVerdict` accepts `votes` and applies `minVotes` / `voteWeight` (settings, with defaults), covered
    by tests. `ChannelRecord.votes` exists in the storage schema.
  - The service worker has a `vote` message that returns "phase 2": a vote client would plug in there.
  - The popup and Settings need their vote controls back.
  - A backend also needs a `host_permissions` entry for its origin, a privacy policy update, and opt-in consent.
- **Confirmations depend on the channel feed.** While it's down, a first label stays *Inconclusive*. A fallback
  would ask YouTube for the channel's videos another way: a new request, so `PRIVACY.md` and `docs/STORE.md`
  would change too.
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
6. **Translations.** The UI and the store listing in other languages, through `chrome.i18n`. The UI is English
   only for now, although detection already works in any language.
