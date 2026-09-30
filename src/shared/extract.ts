/**
 * Channel/video ID extraction from YouTube renderer data. Pure — operates on plain objects.
 *
 * Rendered links only contain @handles (e.g. /@veritasium), which are mutable display names.
 * The stable UC… channel ID lives in the JS data attached to each renderer element, readable only
 * from the page's MAIN world (see src/bridge/bridge.ts). Per surface (verified 2026-09-28):
 *
 *   ytd-video-renderer (search), ytd-compact-video-renderer, ytd-rich-grid-media, ytd-playlist-panel-video-renderer:
 *     el.data.{ownerText|longBylineText|shortBylineText}.runs[0].navigationEndpoint.browseEndpoint.browseId
 *   yt-lockup-view-model (new home/sidebar/search):
 *     el.rawProps.data().metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel
 *       .rendererContext.commandContext.onTap.innertubeCommand.browseEndpoint.browseId
 *     (contentId = video ID when contentType === "LOCKUP_CONTENT_TYPE_VIDEO")
 *   ytm-shorts-lockup-view-model(-v2) (Shorts shelves): NO channel data at all — only the video ID from
 *     the /shorts/<id> link. Resolved via a locally learned videoId -> channelId map when possible.
 *   Watch / Shorts player: playerResponse.videoDetails.channelId
 *   Channel page: response.metadata.channelMetadataRenderer.externalId
 *
 * We ONLY trust `browseEndpoint.browseId` values. A plain /UC.{22}/ scan over renderer JSON produces
 * false positives from base64 tracking params (seen in practice on Shorts shelves).
 */

export const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
export const VIDEO_ID_RE = /^[\w-]{11}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object';

/** Owner fields in the order YouTube's classic renderers use them. */
const OWNER_KEYS = ['ownerText', 'longBylineText', 'shortBylineText', 'channelThumbnailSupportedRenderers', 'channelThumbnail'];

/** Bounded breadth-first search for the first browseEndpoint whose browseId is a channel ID. */
export function findChannelBrowseId(root: unknown, maxNodes = 5000): string | null {
  const queue: unknown[] = [root];
  let seen = 0;
  while (queue.length && seen++ < maxNodes) {
    const node = queue.shift();
    if (!isObj(node)) continue;
    const be = node.browseEndpoint;
    if (isObj(be) && typeof be.browseId === 'string' && CHANNEL_ID_RE.test(be.browseId)) return be.browseId;
    for (const v of Array.isArray(node) ? node : Object.values(node)) if (isObj(v)) queue.push(v);
  }
  return null;
}

export function channelIdFromRendererData(data: unknown): string | null {
  if (!isObj(data)) return null;
  for (const k of OWNER_KEYS) {
    const id = findChannelBrowseId(data[k], 500);
    if (id) return id;
  }
  // Lockup view models: the avatar/byline sits under `metadata`.
  if (isObj(data.metadata)) {
    const id = findChannelBrowseId(data.metadata);
    if (id) return id;
  }
  return null;
}

export function videoIdFromRendererData(data: unknown): string | null {
  if (!isObj(data)) return null;
  if (typeof data.videoId === 'string' && VIDEO_ID_RE.test(data.videoId)) return data.videoId;
  if (
    typeof data.contentId === 'string' &&
    VIDEO_ID_RE.test(data.contentId) &&
    (data.contentType === undefined || data.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')
  ) {
    return data.contentId;
  }
  return null;
}

/** /watch?v=ID, /shorts/ID, absolute or relative. */
export function videoIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = /[?&]v=([\w-]{11})/.exec(href) ?? /\/shorts\/([\w-]{11})/.exec(href);
  return m ? m[1]! : null;
}

/**
 * The one channel a shelf is about, or null if it mentions zero or several channels.
 * Used to attribute channel-less Shorts tiles in search ("Latest Shorts from X" follows "Latest from X").
 */
export function soleChannel(root: unknown, maxNodes = 20_000): { id: string; name?: string } | null {
  const ids = new Set<string>();
  let name: string | undefined;
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length && seen++ < maxNodes) {
    const node = stack.pop();
    if (!isObj(node)) continue;
    const be = node.browseEndpoint;
    if (isObj(be) && typeof be.browseId === 'string' && CHANNEL_ID_RE.test(be.browseId)) ids.add(be.browseId);
    // Byline runs look like { text: "Channel", navigationEndpoint: { browseEndpoint: { browseId: "UC…" } } }
    const nav = node.navigationEndpoint;
    const navBe = isObj(nav) ? nav.browseEndpoint : undefined;
    if (!name && typeof node.text === 'string' && isObj(navBe) && CHANNEL_ID_RE.test(String(navBe.browseId))) name = node.text;
    for (const v of Array.isArray(node) ? node : Object.values(node)) if (isObj(v)) stack.push(v);
  }
  return ids.size === 1 ? { id: [...ids][0]!, name } : null;
}

/**
 * The video a watch-page response belongs to (`currentVideoEndpoint.watchEndpoint.videoId`, verified 2026-09-30),
 * or null if the response doesn't say (Shorts responses don't). Lets the bridge reject stale page data.
 */
export function watchVideoIdOf(response: unknown): string | null {
  if (!isObj(response)) return null;
  const cve = response.currentVideoEndpoint;
  const we = isObj(cve) ? cve.watchEndpoint : undefined;
  return isObj(we) && typeof we.videoId === 'string' && VIDEO_ID_RE.test(we.videoId) ? we.videoId : null;
}

export function channelIdFromChannelPage(response: unknown): string | null {
  if (!isObj(response)) return null;
  const meta = isObj(response.metadata) ? response.metadata.channelMetadataRenderer : undefined;
  if (isObj(meta) && typeof meta.externalId === 'string' && CHANNEL_ID_RE.test(meta.externalId)) return meta.externalId;
  return null;
}

export function channelNameFromChannelPage(response: unknown): string | undefined {
  if (!isObj(response)) return undefined;
  const meta = isObj(response.metadata) ? response.metadata.channelMetadataRenderer : undefined;
  return isObj(meta) && typeof meta.title === 'string' ? meta.title : undefined;
}
