import type { ChannelRecord, Override, Overrides, PageInfo, VerdictResult } from './types';

/** Messages handled by the service worker (the single writer for channel data). */
export type SwRequest =
  | { type: 'observe'; channelId: string; name?: string; videoId: string; labeled: boolean }
  | { type: 'refresh'; channelIds: string[] }
  | { type: 'setOverride'; channelId: string; name?: string; verdict: 'ai' | 'human' | null }
  | { type: 'vote'; channelId: string; vote: 'ai' | 'human' }
  | { type: 'flagged'; videoIds: string[] }
  | { type: 'learnVideos'; pairs: [videoId: string, channelId: string][] }
  | { type: 'getChannel'; channelId: string }
  /** Background checks: ask for a slot under the global rate limit / daily cap before each request. */
  | { type: 'checkPermit' }
  | { type: 'checkFailed'; status: number }
  /** Settings page: merge an imported backup's marks and channels, or forget all observations. */
  | { type: 'importData'; overrides: Overrides; channels: Record<string, ChannelRecord> }
  | { type: 'clearObservations' };

export type CheckPermit = { ok: true } | { ok: false; retryAfterMs: number; reason: 'off' | 'spacing' | 'cap' | 'backoff' };

export interface ChannelSummary {
  channelId: string;
  record?: ChannelRecord;
  override?: Override;
  result: VerdictResult;
}

/** Messages the content script answers (sent by the popup to the active tab). */
export type TabRequest = { type: 'getPageInfo' };
export type TabResponse = { page: PageInfo | null };

/** The service worker answers `{ error }` when a handler throws (e.g. storage quota exceeded). */
export const isSwError = (r: unknown): r is { error: string } => !!r && typeof r === 'object' && 'error' in r;

/**
 * Sends a request to the service worker. Resolves to undefined, never to `{ error }`, when the handler failed or
 * the worker is unreachable, so callers only ever see a real answer or nothing.
 */
export async function sendToSw<T = unknown>(msg: SwRequest): Promise<T | undefined> {
  try {
    const r: unknown = await chrome.runtime.sendMessage(msg);
    if (!isSwError(r)) return r as T;
    console.warn('Botless: service worker error:', r.error);
  } catch {
    /* worker restarting or extension reloaded */
  }
  return undefined;
}
