# YouTube DOM & data findings

Inspected live on **2026-09-28**, desktop `www.youtube.com`, logged out, English UI. YouTube changes its
markup often. When something breaks, re-check the items below first. Every selector and data path the
extension relies on is listed here.

## 1. Official AI disclosure

### Where it lives

The disclosure is a section inside the video's **structured description**. It is present in the watch
response for both regular videos and Shorts.

```
response.engagementPanels[i]
  .engagementPanelSectionListRenderer.content
  .structuredDescriptionContentRenderer.items[j]
  .howThisWasMadeSectionViewModel
```

A real example (video `ZneqyXsgpO4`, tracking params removed):

```json
{
  "sectionTitle": { "content": "How this was made" },
  "bodyHeader":   { "content": "Made with AI" },
  "bodyText": {
    "content": "Sounds or visuals were altered or fully generated. Learn more",
    "commandRuns": [{ "onTap": { "innertubeCommand": { "urlEndpoint": {
      "url": "//support.google.com/youtube/answer/15447836?hl=en" } } } }]
  }
}
```

Rendered DOM:

```html
<how-this-was-made-section-view-model class="ytwHowThisWasMadeSectionViewModelHost">
  <div class="ytwHowThisWasMadeSectionViewModelSectionTitle">How this was made</div>
  <div class="ytwHowThisWasMadeSectionViewModelBodyHeader">Made with AI</div>
  <div class="ytwHowThisWasMadeSectionViewModelBodyText">… <a href="https://support.google.com/youtube/answer/15447836?hl=en">Learn more</a></div>
</how-this-was-made-section-view-model>
```

### Pitfall: "Auto-dubbed" uses the same section

The same `howThisWasMadeSectionViewModel` also appears on videos that YouTube **automatically dubbed**.
That is not a creator AI disclosure. In a sample of 11 AI-music search results, **4 of the 5** videos with
the section were only auto-dubbed:

```json
{ "bodyHeader": { "content": "Auto-dubbed" },
  "bodyText":   { "content": "Audio tracks for some languages were automatically generated. Learn more" },
  … "url": "//support.google.com/youtube/answer/15569972?hl=en" }
```

If you only check that the section exists, many ordinary channels would be flagged. See
`src/shared/disclosure.ts`.

### How we classify it (language-independent first)

| Signal | Meaning |
|---|---|
| Link to `support.google.com/youtube/answer/15447836` | **Made with AI** → counts as AI |
| Link to `…/answer/14328491` | Older "Altered or synthetic content" article → counts as AI |
| Link to `…/answer/15569972` | **Auto-dubbed** → explicitly *not* AI |
| Header/body text (English fallback) | `Made with AI`, `Altered or synthetic`, `altered or fully generated`, `digitally altered/generated` |

The spec mentioned "Altered or synthetic content". That wording is **no longer what YouTube shows**. The
current label is "Made with AI". The old wording is kept as a text fallback. The `hl=` URL parameter was
ignored during this session (the header stayed English), so **localized header text is unverified**.
That is why the help-article ID is checked first.

We only look inside `howThisWasMadeSectionViewModel`, never at titles or descriptions. A creator who
writes "made with AI" in a title does not trigger the signal.

We did not find a separate in-player "Altered or synthetic content" overlay on the sampled videos. Such
an overlay has been reported for sensitive topics. If one appears, it would need to be added here.

### Reading it fresh after SPA navigation

`window.ytInitialData` / `ytInitialPlayerResponse` are only correct for the **first** page load. After
that:

| Source | Works | Notes |
|---|---|---|
| `yt-navigate-finish` event → `detail.response.{response, playerResponse}` | ✅ | Fires for watch pages **and every Shorts swipe**. Primary source. |
| `document.querySelector('ytd-page-manager').getCurrentData()` → `{response, playerResponse}` | ✅ | Used when the extension attaches after the event already fired. |
| `ytInitialData` | ⚠️ | First load only. Last-resort fallback. |
| Rendered `how-this-was-made-section-view-model` | ⚠️ | May be stale during SPA transitions. Only used if the data has no structured description at all (i.e. the shape changed). |

Events observed per navigation: `yt-navigate-start` → `yt-page-data-fetched` → `yt-navigate-finish` →
`yt-page-data-updated`.

## 2. Channel IDs per surface

Rendered links contain only `@handles` (for example `/@veritasium`). Handles can be changed by the owner,
so they are unusable as keys. The stable `UC…` ID lives in **JS properties** on YouTube's custom elements.
A content script's isolated world cannot read those properties, so `src/bridge/bridge.ts` runs in the
page's MAIN world and copies the IDs into `data-botless-*` attributes.

| Surface | Element | Channel ID path (verified) |
|---|---|---|
| Search results | `ytd-video-renderer` | `el.data.ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId` |
| Home feed, watch sidebar, parts of search (new markup) | `yt-lockup-view-model` | `el.rawProps.data()` → `.metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel.rendererContext.commandContext.onTap.innertubeCommand.browseEndpoint.browseId` |
| Older sidebar / grids / playlists | `ytd-compact-video-renderer`, `ytd-rich-grid-media`, `ytd-grid-video-renderer`, `ytd-playlist-*-renderer` | `el.data.{ownerText,longBylineText,shortBylineText}…browseEndpoint.browseId` |
| Shorts shelves | `ytm-shorts-lockup-view-model(-v2)` | **None.** `rawProps` is empty. The parent `grid-shelf-view-model` data holds only `reelWatchEndpoint.videoId`. |
| Watch page | `#movie_player` | `playerResponse.videoDetails.channelId` (also `.author` for the name) |
| Shorts player | `#shorts-player` | `getPlayerResponse().videoDetails.channelId` |
| Channel page | — | `response.metadata.channelMetadataRenderer.externalId` |

Notes:

- `el.rawProps.data` on lockups is a **function** (a signal getter), not an object.
- Lockups carry `contentId` + `contentType: "LOCKUP_CONTENT_TYPE_VIDEO"`. For playlists `contentId` is not
  a video ID.
- **Don't regex for `UC[\w-]{22}` over renderer JSON.** On a Shorts shelf this matched
  `UChgCIhMIg_CDmIKRlwMVWiS`, which is part of a base64 tracking param. Only `browseEndpoint.browseId` is
  trusted.
- Shorts tiles get a channel in three cases (`contextChannelId` in `bridge.ts`):
  1. **On a channel's own page** (Home, Shorts tab): the page's `externalId`.
  2. **In search, "Latest Shorts from X"** (a `grid-shelf-view-model`): its previous sibling is X's
     `ytd-shelf-renderer` "Latest from X". We accept it only if that shelf mentions exactly one channel ID
     and the Shorts shelf title contains that channel's name. Verified 2026-09-28. Generic "Shorts"
     shelves (mixed channels) correctly get nothing.
  3. **Video already seen elsewhere**: the video → channel pair is in the local map (`vmap`, 3000 entries
     max).

  Otherwise the tile stays unbadged. Fetching each Short's page would fix that, but it costs one request
  per tile, so we don't.
- YouTube **recycles** tile elements while scrolling: the same element gets new data and a new `href`.
  The bridge re-stamps an element whenever its first watch/shorts link `href` changes.
- `meta[itemprop="channelId"]` was absent on the SPA watch page.
- A search results page in the new layout had lockup ad slots whose links were `googleadservices.com`.
  Anything inside `ytd-ad-slot-renderer` / `ytd-in-feed-ad-layout-renderer` is skipped.

## 3. Thumbnails, owner area, theme

| Purpose | Selector |
|---|---|
| Thumbnail container (badge host) | `yt-thumbnail-view-model`, `.ytLockupViewModelContentImage`, `[class*=shortsLockupViewModelHostThumbnail…]`, `ytd-thumbnail`, `a#thumbnail` |
| Cell to fade/hide (so grids reflow) | `ytd-rich-item-renderer`, `[class*=GridShelfViewModelGridShelfItem]`, … |
| Watch page channel name | `ytd-watch-metadata ytd-video-owner-renderer #channel-name` |
| Shorts channel bar | `ytd-shorts yt-reel-channel-bar-view-model` (inside `ytd-reel-video-renderer`) |
| Dark theme | `html[dark]` attribute (also `is-dark-theme` on `ytd-watch-flexy`) |
| Next video | `#movie_player .ytp-next-button`. Hidden (`display:none`) in small player layouts, but `click()` still works, so we use it whenever its `href` points at a video. Otherwise the fallback is `history.back()`. |
| Next Short | `#navigation-button-down button` |

Hidden tabs: YouTube skips rendering the Shorts overlay, and `requestAnimationFrame` doesn't fire. The
content script's render pass uses rAF, so badges are applied once the tab is visible. The owner pill is
re-added on every scan if it's missing.

## 4. YouTube Data API v3

`videos` resource → `status.containsSyntheticMedia` (boolean) exists
([reference](https://developers.google.com/youtube/v3/docs/videos)). The docs describe it as the field a
channel owner sets in `videos.insert` / `videos.update` to **disclose** A/S content. We did not verify
whether `videos.list` returns it for other people's videos, because that needs an API key and a network
call.

**Not used**, because:

1. Phase 1 must send no data anywhere. Every API call would reveal the video IDs the user sees to Google
   Cloud under our key.
2. It would need an extra host permission (`https://www.googleapis.com/*`) and an API key shipped in
   the extension, with quota limits of 1 unit per call and 10k/day by default.
3. The watch page already contains the same disclosure for free.

If phase 2 adds a backend, the server could call it in batch (`videos.list?part=status&id=…`, up to 50
IDs per call) to pre-compute channel ratios without the user watching anything.

## 5. Endpoints used by background checks (opt-in)

Verified 2026-09-28 from a youtube.com page, with `credentials: "omit"` (no cookies):

| Request | Returns | Size / time |
|---|---|---|
| `POST /youtubei/v1/next?prettyPrint=false` with body `{"context":{"client":{"clientName":"WEB","clientVersion":"2.20260925.01.00","hl":"en","gl":"US"}},"videoId":"…"}` | Same data as a watch page: `contents.twoColumnWatchNextResults.results.results.contents[].videoSecondaryInfoRenderer.owner.videoOwnerRenderer` (channel ID + name) and the engagement panels with `howThisWasMadeSectionViewModel` | 330–560 KB of JSON (before compression), about 1 s. A full `/watch` page is 1.2–2 MB. |
| `GET /feeds/videos.xml?channel_id=UC…` | Atom feed of the channel's 15 latest uploads (`<yt:videoId>`) | about 22 KB |

Observations:

- Unlabeled videos still include `structuredDescriptionContentRenderer`. Its absence therefore means "format
  changed", not "no label", and in that case nothing is recorded.
- The client version must look current. The bridge copies the page's `ytcfg INNERTUBE_CLIENT_VERSION` into
  `html[data-botless-client]`, and `check.ts` holds a fallback.
- Real-world example: We R Cinephiles' newest Short (`TCp_fT90F5s`) has **no** label, although several of
  its other videos do. That's why one label alone never makes a channel "Probably AI".

## 6. "Don't recommend channel"

Verified 2026-09-28 on a signed-in home feed with a French UI. A signed-out session doesn't have the item at
all: logged-out menus only offer queue, save and share.

**Data.** Every home-feed `yt-lockup-view-model` carries its ⋮ menu inline:

```
rawProps.data().metadata.lockupMetadataViewModel.menuButton.buttonViewModel.onTap.innertubeCommand
  .showSheetCommand.panelLoadingStrategy.inlineContent.sheetViewModel.content.listViewModel.listItems[]
```

| Item (FR) | `leadingImage…clientResource.imageName` | Command |
|---|---|---|
| Pas intéressé ("Not interested") | `HIDE` | `feedbackEndpoint` (+ `undoFeedbackEndpoint`) |
| **Ne pas recommander la chaîne** ("Don't recommend channel") | **`REMOVE`** | `feedbackEndpoint { feedbackToken, uiActions.hideEnclosingContainer }`, POST `/youtubei/v1/feedback`, response action `replaceEnclosingAction` → notification with an **Annuler/Undo** button (`undoFeedbackEndpoint.undoToken`) |

We identify the item by `imageName: "REMOVE"` plus the presence of a `feedbackToken`, never by its text.
16 of 21 home tiles had it; the rest were mixes and playlists. Scanning all tiles took 7 ms.

**UI path used by the bridge.**

1. The menu button is `.ytLockupMetadataViewModelMenuButton button` (aria-label "Autres actions" / "More actions").
2. Clicking it opens `tp-yt-iron-dropdown` › `yt-sheet-view-model` › `yt-list-item-view-model` items. Each
   item has an inner `<button>`. The rendered menu can contain items that aren't in the data (for example
   "Télécharger"), so we match the rendered item's text against the **title taken from the data**.
3. Search only inside **opened** dropdowns. YouTube keeps old menus' items in the DOM.
4. Close with the dropdown's own `close()`. A synthetic `Escape` keydown did **not** close it (verified).
5. In a hidden tab, the dropdown opens (`opened: true`) but doesn't lay out (`display: none`, zero-height
   items). So we don't run in hidden tabs at all.

Dry-run results (menu opened invisibly, item found, closed without clicking) on three different tiles: the
item was found within 50 ms each time and the menu closed cleanly.

**Shorts tiles (signed in).** `ytm-shorts-lockup-view-model-v2` has `rawProps` keys `entityId`,
`accessibilityText`, `onTap`, `inlinePlayerData` and `menuOnTap`. There is still **no channel ID** anywhere
in the tile or its shelf (`ytd-rich-shelf-renderer`, 75 KB of data, zero `browseId`s). Its menu offers
"Ajouter à la file d'attente" (`ADD_TO_QUEUE_TAIL`), **"Pas intéressé" (`HIDE`, feedbackEndpoint)**,
"Envoyer des commentaires" (`FEEDBACK`) and "Signaler" (`FLAG`), but **no "Don't recommend channel"**. So
for Shorts Botless uses "Not interested". The ⋮ button is
`.shortsLockupViewModelHostOutsideMetadataMenu button`, and the button host is
`.shortsLockupViewModelHostOutsideMetadataSubhead` (under the view count). A dry run (menu opened
invisibly, "Pas intéressé" found, closed without clicking) succeeded.
