import type { ChannelRecord, Override, PageInfo, VerdictResult } from './types';

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
  /** YouTube accepted "Don't recommend channel" for this channel (via its own menu). */
  | { type: 'dontRecommended'; channelId: string; name?: string; auto: boolean };

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

export const sendToSw = <T = unknown>(msg: SwRequest): Promise<T> => chrome.runtime.sendMessage(msg);
