# Chrome Web Store submission

Ready-to-paste answers for the developer dashboard. They must stay consistent with
[`PRIVACY.md`](../PRIVACY.md): Google rejects listings whose privacy answers and policy disagree. Upload the
`botless-X.Y.Z.zip` attached to the GitHub release, not a local build.

## Store listing

- **Summary** (from the manifest, 132 characters max): *Judges each YouTube channel as Probably Human,
  Probably AI or Inconclusive. Badge, fade, hide or auto-skip. Runs locally.*
- **Category:** Tools.
- **Description:**

  > Botless labels YouTube channels as **Probably AI**, **Probably Human** or **Inconclusive**, so AI-generated
  > channels stop filling your feed.
  >
  > It relies on YouTube's own "Made with AI" disclosure: every video you watch adds to its channel's record,
  > and a channel whose videos are consistently labeled is marked Probably AI. A single labeled video is
  > flagged on its own, and your manual marks always win.
  >
  > • Badge, fade or completely hide each verdict's videos, in feeds, search, the sidebar and Shorts
  > • Optional auto-skip of Probably AI videos, with Undo
  > • Mark any channel as AI or human yourself
  > • Active mode (off by default): checks videos on your screen before you watch them, without your cookies
  >
  > Private by design: no servers, no accounts, no analytics. Everything stays on your device, and with Active
  > mode off Botless sends nothing anywhere. It never acts on your YouTube account.
  >
  > Open source (GPL-3.0): https://github.com/j3ffx/botless
  >
  > Botless is an independent project, not affiliated with, endorsed by or sponsored by YouTube or Google.

Images (PNG), per Google's image guidelines:

- **Store icon** (required, 128×128): 96×96 artwork inside 16 px of transparent padding, readable on light and
  dark backgrounds.
- **Screenshots** (required, at least 1, up to 5; 1280×800 or 640×400, full bleed): a watch page with the
  *Probably AI* pill; search results with badges; the popup; Settings. Take them signed out, or crop out the
  account avatar.
- **Small promo tile** (required, 440×280).
- **Marquee** (optional, 1400×560): only used if the store features the extension.

## Privacy practices tab

**Single purpose**

> Labels YouTube channels as probably AI-generated, probably human or inconclusive, based on YouTube's own AI
> disclosure labels, so the user can badge, fade, hide or skip their videos.

**Permission justifications**

| Permission | Justification |
|---|---|
| `storage` | Keeps the user's settings, their manual channel marks and what Botless has observed about each channel, on the device only. |
| Host permission `https://www.youtube.com/*` | Botless only works on YouTube. Its content scripts read channel IDs and YouTube's AI disclosure label from the page and add labels to thumbnails. With the optional, off-by-default Active mode, it also requests public video information from www.youtube.com, without cookies. |

**Remote code:** No, I am not using remote code. All JavaScript is in the package; nothing is downloaded or
evaluated at run time (checked by `scripts/check-dist.mjs`).

**Data usage.** Google counts data even when it only stays on the device. Tick:

- **Web history:** the IDs of YouTube videos the user watched, per channel, kept locally.
- **Website content:** YouTube's AI disclosure label, channel IDs and channel names, read from YouTube pages.

Leave every other category unticked (no personal identifiers, health, financial, authentication,
communications, location or user activity data). Then tick all three certifications: data isn't sold or
transferred to third parties, isn't used for purposes unrelated to the single purpose, and isn't used for
creditworthiness or lending.

**Privacy policy URL:** `https://j3ffx.github.io/botless/privacy.html` (generated from `PRIVACY.md` on every
change; the GitHub file URL works too).

**Official URL:** `https://j3ffx.github.io/botless/`, verified in Google Search Console with the publisher
account (the ownership file is `site/google*.html`).

## Keep in sync

If a change stores something new, sends a new request, or needs a new permission, update `PRIVACY.md`, this
file and the README's Privacy section in the same pull request. The store answers must then be updated too.
