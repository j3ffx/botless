/**
 * Validation of everything that crosses a trust boundary. PURE: no DOM, no chrome.*.
 *
 * - Page info comes from the MAIN world, where YouTube's scripts, other extensions or an injected script can
 *   dispatch the same `botless:page` event or set the same `data-botless-*` attributes as our bridge. It is
 *   only accepted when well formed and about the page actually shown.
 * - Service worker requests are checked again on arrival (defence in depth), with every list capped, so a
 *   compromised content script can't write arbitrary shapes or sizes into storage.
 */
import { cleanChannels, cleanOverrides } from './backup';
import { CHANNEL_ID_RE, VIDEO_ID_RE, videoIdFromHref } from './extract';
import type { SwRequest } from './messages';
import type { Disclosure, PageInfo, PageType } from './types';

export const MAX_NAME = 200;
/** Upper bound for the ID lists a single message may carry (the content script batches far fewer). */
export const MAX_IDS = 500;

const PAGE_TYPES: readonly PageType[] = ['watch', 'shorts', 'channel', 'other'];
const DISCLOSURES: readonly Disclosure[] = ['ai', 'auto-dubbed', 'none'];
const SOURCES = ['data', 'dom', 'unknown'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v);

export const isChannelId = (v: unknown): v is string => typeof v === 'string' && CHANNEL_ID_RE.test(v);
export const isVideoId = (v: unknown): v is string => typeof v === 'string' && VIDEO_ID_RE.test(v);
/** A display name: a string, trimmed to MAX_NAME characters. */
export const cleanName = (v: unknown): string | undefined => (typeof v === 'string' && v ? v.slice(0, MAX_NAME) : undefined);

/**
 * Page info from the bridge, or null if it's malformed or not about `href` (the page actually shown).
 * A video ID must be the one in the address bar, so a forged event can't record observations for other videos.
 */
export function parsePageInfo(raw: unknown, href: string): PageInfo | null {
  if (!isObj(raw) || raw.url !== href || !oneOf(raw.pageType, PAGE_TYPES)) return null;
  const info: PageInfo = { pageType: raw.pageType, url: href };
  if (raw.videoId !== undefined) {
    if (!isVideoId(raw.videoId) || raw.videoId !== videoIdFromHref(href)) return null;
    info.videoId = raw.videoId;
  }
  if (raw.channelId !== undefined) {
    if (!isChannelId(raw.channelId)) return null;
    info.channelId = raw.channelId;
  }
  const name = cleanName(raw.channelName);
  if (name) info.channelName = name;
  if (oneOf(raw.disclosure, DISCLOSURES)) info.disclosure = raw.disclosure;
  if (oneOf(raw.disclosureSource, SOURCES)) info.disclosureSource = raw.disclosureSource;
  return info;
}

const ids = (v: unknown, valid: (x: unknown) => x is string, max: number): string[] | null =>
  Array.isArray(v) ? v.filter(valid).slice(0, max) : null;

/** A request to the service worker, rebuilt from validated fields only; null if it isn't one. */
export function parseSwRequest(raw: unknown): SwRequest | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'observe':
      if (!isChannelId(raw.channelId) || !isVideoId(raw.videoId) || typeof raw.labeled !== 'boolean') return null;
      return { type: 'observe', channelId: raw.channelId, videoId: raw.videoId, labeled: raw.labeled, name: cleanName(raw.name) };
    case 'refresh': {
      const channelIds = ids(raw.channelIds, isChannelId, 200);
      return channelIds && { type: 'refresh', channelIds };
    }
    case 'setOverride':
      if (!isChannelId(raw.channelId) || !(raw.verdict === 'ai' || raw.verdict === 'human' || raw.verdict === null)) return null;
      return { type: 'setOverride', channelId: raw.channelId, verdict: raw.verdict, name: cleanName(raw.name) };
    case 'vote':
      if (!isChannelId(raw.channelId) || !(raw.vote === 'ai' || raw.vote === 'human')) return null;
      return { type: 'vote', channelId: raw.channelId, vote: raw.vote };
    case 'flagged': {
      const videoIds = ids(raw.videoIds, isVideoId, MAX_IDS);
      return videoIds && { type: 'flagged', videoIds };
    }
    case 'learnVideos': {
      if (!Array.isArray(raw.pairs)) return null;
      const pairs = raw.pairs
        .filter((p): p is [string, string] => Array.isArray(p) && p.length === 2 && isVideoId(p[0]) && isChannelId(p[1]))
        .slice(0, MAX_IDS)
        .map(([v, c]): [string, string] => [v, c]);
      return { type: 'learnVideos', pairs };
    }
    case 'getChannel':
      return isChannelId(raw.channelId) ? { type: 'getChannel', channelId: raw.channelId } : null;
    case 'checkPermit':
      return { type: 'checkPermit' };
    case 'checkFailed':
      return Number.isInteger(raw.status) && (raw.status as number) >= 0 && (raw.status as number) < 1000
        ? { type: 'checkFailed', status: raw.status as number }
        : null;
    case 'importData':
      return { type: 'importData', overrides: cleanOverrides(raw.overrides).overrides, channels: cleanChannels(raw.channels).channels };
    case 'clearObservations':
      return { type: 'clearObservations' };
    default:
      return null;
  }
}
