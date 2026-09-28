/**
 * Background checks (opt-in, off by default): look up YouTube's AI label for channels visible on screen
 * before the user watches anything. Pure helpers only — the fetching lives in src/content/checker.ts and the
 * global rate limit in the service worker.
 *
 * Requests (verified 2026-09-28, docs/YOUTUBE-DOM.md §5):
 *   POST https://www.youtube.com/youtubei/v1/next   {context:{client:{clientName:"WEB",clientVersion}}, videoId}
 *     -> same data as a watch page: owner channel + structured description (incl. the AI label). ~0.3–0.6 MB.
 *   GET  https://www.youtube.com/feeds/videos.xml?channel_id=UC…   -> the channel's 15 latest video IDs. ~22 KB.
 * Both are sent with `credentials: "omit"`: no cookies, so they can't touch the user's account or history.
 */
import { detectDisclosureInData } from './disclosure';
import { CHANNEL_ID_RE, VIDEO_ID_RE } from './extract';
import type { ChannelRecord, Disclosure, Override } from './types';

/**
 * Min gap between two requests across all tabs. Deliberately NOT a user setting: request rate is what bot detection
 * reacts to, so this is the safety net. The daily total is user-tunable (Settings.checkDailyLimit).
 */
export const CHECK_SPACING_MS = 3000;
/** Pause after YouTube answers 429/403/5xx. */
export const CHECK_BACKOFF_MS = 15 * 60_000;
/** Used only if the page's own client version can't be read. */
export const FALLBACK_CLIENT_VERSION = '2.20260925.01.00';

/**
 * What a channel needs next:
 *  'video'   — nothing known yet: check the video on the tile.
 *  'confirm' — exactly one video seen and it was labeled: check one more recent video before saying
 *              "Probably AI" (one label alone only makes it Inconclusive).
 *  null      — enough data already, or the user marked it themselves.
 */
export type CheckNeed = 'video' | 'confirm' | null;

export function checkNeed(record: ChannelRecord | undefined, override: Override | undefined): CheckNeed {
  if (override) return null;
  const flags = record ? Object.values(record.videos) : [];
  if (flags.length === 0) return 'video';
  if (flags.length === 1 && flags[0] === 1) return 'confirm';
  return null;
}

export function nextRequestBody(videoId: string, clientVersion: string): string {
  // English UI so the text fallback in disclosure.ts applies; the help-article ID match is language independent anyway.
  return JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } }, videoId });
}

export interface CheckResult {
  channelId: string | null;
  channelName?: string;
  /** null = response had no description section at all (format changed): record nothing. */
  disclosure: Disclosure | null;
}

type Obj = Record<string, any>;

export function parseNextResponse(json: unknown): CheckResult {
  const contents = (json as Obj)?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
  let owner: Obj | undefined;
  if (Array.isArray(contents)) {
    for (const c of contents) {
      owner = c?.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer;
      if (owner) break;
    }
  }
  const id = owner?.navigationEndpoint?.browseEndpoint?.browseId;
  const { disclosure, found } = detectDisclosureInData(json);
  return {
    channelId: typeof id === 'string' && CHANNEL_ID_RE.test(id) ? id : null,
    channelName: typeof owner?.title?.runs?.[0]?.text === 'string' ? owner.title.runs[0].text : undefined,
    disclosure: found ? disclosure : null,
  };
}

/** Video IDs from a channel's RSS feed, newest first. */
export function parseChannelFeed(xml: string): string[] {
  return [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map((m) => m[1]!).filter((id) => VIDEO_ID_RE.test(id));
}

/** The newest video from the feed that we haven't checked for this channel yet. */
export function pickConfirmVideo(feed: string[], record: ChannelRecord | undefined): string | null {
  return feed.find((id) => !(record && id in record.videos)) ?? null;
}
