/**
 * MAIN-world bridge. Runs in YouTube's own JS context (manifest `"world": "MAIN"`), because the channel
 * IDs we need live in JS properties on YouTube's elements (`el.data`, `el.rawProps`), which the isolated
 * content-script world cannot see. This script has NO chrome.* access and makes NO network requests.
 *
 * It only:
 *   1. Stamps renderer elements with `data-botless-vid` / `data-botless-cid` / `data-botless-key` attributes.
 *      DOM attributes are shared across worlds, so the content script reads them from there.
 *   2. Reports the current page (video, channel, official AI disclosure) as a JSON-string CustomEvent.
 *      Strings are used because object `detail`s do not reliably cross the world boundary.
 */
import { detectDisclosureInData, detectDisclosureInDom } from '../shared/disclosure';
import {
  CHANNEL_ID_RE,
  channelIdFromChannelPage,
  channelIdFromRendererData,
  channelNameFromChannelPage,
  videoIdFromHref,
  videoIdFromRendererData,
} from '../shared/extract';
import type { PageInfo, PageType } from '../shared/types';

/** Leaf renderers that represent one video tile. Wrappers (ytd-rich-item-renderer) are handled by the content script. */
const TILE_SELECTOR = [
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-rich-grid-media',
  'ytd-playlist-video-renderer',
  'ytd-playlist-panel-video-renderer',
  'ytd-reel-item-renderer',
  'yt-lockup-view-model',
  'ytm-shorts-lockup-view-model-v2',
  'ytm-shorts-lockup-view-model:not(ytm-shorts-lockup-view-model-v2 *)',
].join(',');

const AD_SELECTOR = 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer';
const LINK_SELECTOR = 'a[href*="/watch?v="], a[href*="/shorts/"]';
const SHORTS_TILE = /^YTM-SHORTS-LOCKUP|^YTD-REEL-ITEM/;

type AnyEl = HTMLElement & { data?: unknown; __data?: { data?: unknown }; rawProps?: { data?: unknown } };

function rendererData(el: AnyEl): unknown {
  try {
    if (el.data && typeof el.data === 'object') return el.data;
    if (el.__data?.data) return el.__data.data;
    const d = el.rawProps?.data;
    return typeof d === 'function' ? (d as () => unknown)() : d;
  } catch {
    return undefined;
  }
}

function stamp(el: AnyEl): boolean {
  const link = el.querySelector(LINK_SELECTOR);
  const href = link?.getAttribute('href') ?? '';
  // YouTube recycles tile elements while scrolling; a changed href means a new video in the same element.
  if (href && el.dataset.botlessHref === href) return false;
  if (el.closest(AD_SELECTOR)) return false;

  const data = rendererData(el);
  const vid = videoIdFromRendererData(data) ?? videoIdFromHref(href);
  const cid = channelIdFromRendererData(data);
  const shortsTile = SHORTS_TILE.test(el.tagName);
  // Classic tiles sometimes get their data a tick after their href: drop any stale stamp from the
  // element's previous video and retry on a later pass (botlessHref stays unset so we come back).
  if ((!vid && !cid) || (!cid && !shortsTile)) {
    if (el.dataset.botlessKey) {
      delete el.dataset.botlessKey;
      delete el.dataset.botlessVid;
      delete el.dataset.botlessCid;
      return true;
    }
    return false;
  }

  const key = `${vid ?? ''}|${cid ?? ''}`;
  if (href) el.dataset.botlessHref = href;
  if (el.dataset.botlessKey === key) return false;
  if (vid) el.dataset.botlessVid = vid;
  else delete el.dataset.botlessVid;
  if (cid) el.dataset.botlessCid = cid;
  else delete el.dataset.botlessCid;
  el.dataset.botlessKey = key;
  return true;
}

function scan(): void {
  const tiles = document.querySelectorAll<AnyEl>(TILE_SELECTOR);
  for (const el of tiles) stamp(el);
  document.dispatchEvent(new CustomEvent('botless:scan'));
}

// ---- Debounced observer: never do work inside the MutationObserver callback itself. ----

let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    const run = () => {
      scheduled = false;
      scan();
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 400 });
    else run();
  }, 150);
}

const isOurs = (n: Node): boolean => n instanceof Element && (n.classList.contains('botless-badge') || n.classList.contains('botless-owner'));

new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === 'attributes') return schedule();
    for (const n of r.addedNodes) if (!isOurs(n)) return schedule();
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });

// ---- Page info ----

function pageTypeFromPath(path: string): PageType {
  if (path === '/watch') return 'watch';
  if (path.startsWith('/shorts/')) return 'shorts';
  if (path.startsWith('/@') || path.startsWith('/channel/') || path.startsWith('/c/') || path.startsWith('/user/')) return 'channel';
  return 'other';
}

interface NavData {
  response?: unknown;
  playerResponse?: { videoDetails?: { videoId?: string; channelId?: string; author?: string } };
}

type WinExtras = { ytInitialData?: unknown; ytInitialPlayerResponse?: NavData['playerResponse'] };

function currentNavData(detail?: { response?: NavData }): NavData {
  if (detail?.response) return detail.response;
  const pm = document.querySelector('ytd-page-manager') as (Element & { getCurrentData?: () => NavData }) | null;
  try {
    const d = pm?.getCurrentData?.();
    if (d?.response || d?.playerResponse) return d;
  } catch {
    /* fall through */
  }
  const w = window as unknown as WinExtras;
  return { response: w.ytInitialData, playerResponse: w.ytInitialPlayerResponse };
}

function playerVideoDetails(pageType: PageType): NavData['playerResponse'] {
  const player = document.querySelector(pageType === 'shorts' ? '#shorts-player' : '#movie_player') as
    | (Element & { getPlayerResponse?: () => NavData['playerResponse'] })
    | null;
  try {
    return player?.getPlayerResponse?.();
  } catch {
    return undefined;
  }
}

let lastInfo: PageInfo | null = null;
let domRetry: ReturnType<typeof setTimeout> | undefined;

function emit(info: PageInfo): void {
  lastInfo = info;
  document.dispatchEvent(new CustomEvent('botless:page', { detail: JSON.stringify(info) }));
}

function readPage(detail?: { response?: NavData }): void {
  clearTimeout(domRetry);
  const url = location.href;
  const pageType = pageTypeFromPath(location.pathname);
  const nav = currentNavData(detail);
  const info: PageInfo = { pageType, url };

  if (pageType === 'watch' || pageType === 'shorts') {
    const urlVid = videoIdFromHref(url);
    let vd = nav.playerResponse?.videoDetails;
    if (!vd || vd.videoId !== urlVid) vd = playerVideoDetails(pageType)?.videoDetails;
    if (vd?.videoId === urlVid && vd?.channelId && CHANNEL_ID_RE.test(vd.channelId)) {
      info.videoId = vd.videoId;
      info.channelId = vd.channelId;
      info.channelName = vd.author;
    } else if (urlVid) {
      info.videoId = urlVid;
    }
    const { disclosure, found } = detectDisclosureInData(nav.response);
    if (found) {
      info.disclosure = disclosure;
      info.disclosureSource = 'data';
    } else {
      // Data shape unknown/changed: fall back to the rendered description once it has had time to update.
      info.disclosureSource = 'unknown';
      domRetry = setTimeout(() => {
        if (location.href !== url) return;
        const scope = document.querySelector(pageType === 'watch' ? 'ytd-watch-metadata' : 'ytd-shorts') ?? document;
        emit({ ...info, disclosure: detectDisclosureInDom(scope), disclosureSource: 'dom' });
      }, 2000);
    }
  } else if (pageType === 'channel') {
    info.channelId = channelIdFromChannelPage(nav.response) ?? undefined;
    info.channelName = channelNameFromChannelPage(nav.response);
  }
  emit(info);
}

document.addEventListener('yt-navigate-finish', (e) => readPage((e as CustomEvent).detail));
document.addEventListener('botless:request-page', () => (lastInfo && lastInfo.url === location.href ? emit(lastInfo) : readPage()));
// Safety net for the very first load in case yt-navigate-finish fired before we attached.
window.addEventListener('load', () => setTimeout(() => lastInfo?.url !== location.href && readPage(), 1000));
