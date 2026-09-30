# Privacy policy

**Botless for YouTube** · effective 30 September 2026

Botless is a browser extension that labels YouTube channels as *Probably AI*, *Probably Human* or
*Inconclusive*. This policy explains what it handles, where that data stays, and when anything leaves your
device.

## The short version

- Botless has **no servers, no accounts, no analytics and no advertising**. The developer never receives any
  of your data.
- Everything Botless learns is stored **on your device**, in your browser's extension storage.
- By default Botless sends **no requests of its own**. Only if you turn on **Active mode** does it ask
  YouTube itself for public information about videos shown on your screen, without your cookies.
- Botless **never acts on your YouTube account**: no likes, subscriptions, "Not interested" or similar.

## What Botless handles

Botless runs only on `www.youtube.com`. While you use YouTube, it reads from the page:

- the IDs of the videos and channels shown, and the channel names;
- whether a video carries YouTube's own "Made with AI" (altered or synthetic content) label.

From this it keeps, on your device:

| Data | Why | How long |
|---|---|---|
| Your settings | To remember your choices | Until you change them |
| Channels you marked as AI or human | Your marks always decide the verdict | Until you remove them |
| For each channel seen: IDs of videos you watched (or Active mode checked), whether each carried the AI label, the channel name, and a cached verdict | To judge the channel | Up to 200 videos per channel; the channel is forgotten after 180 days unseen (configurable), or sooner if storage runs low |
| Which channel a video belongs to | To label Shorts, whose thumbnails don't name their channel | The newest 3,000 |
| Today's count of flagged videos and of Active mode checks | The popup counter and the daily limit | Reset every day |

This is stored with Chrome's `chrome.storage.local`. It isn't synced to your Google account or sent anywhere.
The exact storage keys are listed in the [README](README.md#privacy).

Botless does **not** handle names, email addresses, passwords, payment details, location, messages, form
contents, or your activity on any site other than `www.youtube.com`.

## When data leaves your device

**Active mode off (the default): never.** Botless makes no network requests of its own. This is checked
automatically on every change to the code.

**Active mode on:** to judge channels before you watch them, Botless asks YouTube about videos whose
thumbnails are on your screen. It sends the **video ID** (and YouTube's app version number) to YouTube's
own `www.youtube.com/youtubei/v1/next` endpoint, and sometimes a **channel ID** to the channel's public feed
at `www.youtube.com/feeds/videos.xml`. These requests:

- go to `www.youtube.com` only, and never follow a redirect to another address;
- are sent **without your cookies**, so they aren't linked to your YouTube or Google account and don't
  appear in your watch history;
- are limited to one every 3 seconds and to a daily maximum you choose (150 by default).

Like any request, they reach YouTube (Google) with your IP address and browser details. What YouTube does
with them is covered by [Google's privacy policy](https://policies.google.com/privacy). You can turn
Active mode off at any time from the popup.

**Export:** if you click *Export* in Settings, Botless saves a backup file to your computer. It goes
wherever you choose to save it, and nowhere else.

## What YouTube's page can see

Badges, faded or hidden thumbnails and the label next to a channel name are part of the YouTube page, so
YouTube's scripts, or another extension on that page, could notice them, including a badge's tooltip such as
"You marked this channel". Your stored data itself never enters the page.

## Sharing and use

Botless doesn't sell, rent, share or transfer your data to anyone. It doesn't use it for advertising, for
credit or lending decisions, or for anything other than labeling YouTube channels for you.

## Your control

- **Turn Botless off** from the popup: it stops recording anything and removes its labels.
- **Clear observations** in Settings deletes every channel Botless has learned (your marks and settings stay).
- **Remove** a mark from the list in Settings.
- **Uninstalling** Botless deletes all of its data.

## Children

Botless isn't directed at children and doesn't knowingly handle any data about them beyond what is
described above.

## Changes

If this policy changes, the new version is published here with a new effective date. Its history is public
in this repository's commit log.

## Contact

Questions: open an issue at [github.com/j3ffx/botless/issues](https://github.com/j3ffx/botless/issues). For
a security or privacy problem you don't want to make public, use **Security → Report a vulnerability** on
the repository instead (see [SECURITY.md](SECURITY.md)).
