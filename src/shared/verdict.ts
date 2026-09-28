import { computeVerdict, type ScoringInput } from './scoring';
import { thresholdsKey, type Settings } from './settings';
import type { CachedVerdict, ChannelRecord, Override, VerdictResult } from './types';

export const MAX_VIDEOS_PER_CHANNEL = 200;
const DAY_MS = 86_400_000;

export function scoringInput(record: ChannelRecord | undefined, override: Override | undefined): ScoringInput {
  const flags = record ? Object.values(record.videos) : [];
  return {
    videosSeen: flags.length,
    videosLabeled: flags.filter((f) => f === 1).length,
    votes: record?.votes,
    override: override?.verdict ?? null,
  };
}

/** A cached verdict is usable if it is younger than the TTL and was computed with the current thresholds. */
export function isCacheFresh(cached: CachedVerdict | undefined, settings: Settings, now: number): cached is CachedVerdict {
  return (
    !!cached &&
    cached.thresholdsKey === thresholdsKey(settings.thresholds) &&
    now - cached.computedAt < settings.cacheTtlDays * DAY_MS
  );
}

/**
 * Verdict for one channel, preferring the cache. Overrides bypass the cache (they are per-user and instant).
 * `stale` tells the caller to ask the service worker to refresh the stored cache.
 */
export function resolveVerdict(
  record: ChannelRecord | undefined,
  override: Override | undefined,
  settings: Settings,
  now: number,
): { result: VerdictResult; stale: boolean } {
  if (override) return { result: computeVerdict(scoringInput(record, override), settings.thresholds), stale: false };
  if (!record) return { result: { verdict: null, score: 0, reasons: [] }, stale: false };
  if (isCacheFresh(record.cached, settings, now)) {
    const { verdict, score, reasons } = record.cached;
    return { result: { verdict, score, reasons }, stale: false };
  }
  return { result: computeVerdict(scoringInput(record, undefined), settings.thresholds), stale: true };
}

/**
 * A video that itself carries YouTube's official AI label is AI content, whatever its channel's verdict.
 * Used for that video only (its tile, or the page while it plays) — the channel verdict is unchanged.
 * The user's own mark still wins, as always.
 */
export function withVideoLabel(channelResult: VerdictResult, videoLabeled: boolean, override: Override | undefined): VerdictResult {
  if (!videoLabeled || override || channelResult.verdict === 'ai') return channelResult;
  return {
    verdict: 'ai',
    score: 1,
    reasons: [{ signal: 'disclosure', text: "This video carries YouTube's AI label", weight: 1 }, ...channelResult.reasons],
  };
}

export function withFreshCache(record: ChannelRecord, settings: Settings, now: number): ChannelRecord {
  const r = computeVerdict(scoringInput(record, undefined), settings.thresholds);
  return { ...record, cached: { ...r, computedAt: now, thresholdsKey: thresholdsKey(settings.thresholds) } };
}

/** Record that we checked `videoId`'s disclosure. Moves it to the newest position and trims the oldest. */
export function addObservation(
  record: ChannelRecord | undefined,
  obs: { channelId: string; name?: string; videoId: string; labeled: boolean },
  now: number,
): ChannelRecord {
  const videos = { ...(record?.videos ?? {}) };
  delete videos[obs.videoId];
  videos[obs.videoId] = obs.labeled ? 1 : 0;
  const ids = Object.keys(videos);
  for (let i = 0; i < ids.length - MAX_VIDEOS_PER_CHANNEL; i++) delete videos[ids[i]!];
  return {
    id: obs.channelId,
    name: obs.name || record?.name,
    videos,
    votes: record?.votes,
    firstSeen: record?.firstSeen ?? now,
    lastSeen: now,
  };
}
