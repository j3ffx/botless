/**
 * chrome.storage.local layout (nothing ever leaves the device in phase 1):
 *
 *   settings      Settings                         user preferences
 *   overrides     Record<channelId, Override>      the user's manual AI/Human marks (never expire)
 *   c:<UC…>       ChannelRecord                    per-channel observations + cached verdict (TTL)
 *   vmap          Record<videoId, channelId>       learned mapping so channel-less Shorts tiles can be badged
 *   stats         DailyStats                       today's flagged-video counter
 *   checks        CheckStats                       background checks done today + backoff (opt-in feature)
 */
import { normalizeSettings, type Settings } from './settings';
import type { ChannelRecord, CheckStats, DailyStats, Overrides } from './types';

export const KEY = {
  settings: 'settings',
  overrides: 'overrides',
  vmap: 'vmap',
  stats: 'stats',
  checks: 'checks',
  channel: (id: string) => `c:${id}`,
} as const;

export const isChannelKey = (k: string): boolean => k.startsWith('c:');
export const VMAP_MAX = 3000;
export const STATS_MAX_IDS = 5000;

const local = () => chrome.storage.local;

export async function getSettings(): Promise<Settings> {
  const { settings } = await local().get(KEY.settings);
  return normalizeSettings(settings);
}

export async function getOverrides(): Promise<Overrides> {
  const { overrides } = await local().get(KEY.overrides);
  return (overrides as Overrides) ?? {};
}

export async function getChannels(ids: string[]): Promise<Record<string, ChannelRecord | undefined>> {
  if (!ids.length) return {};
  const got = await local().get(ids.map(KEY.channel));
  const out: Record<string, ChannelRecord | undefined> = {};
  for (const id of ids) out[id] = got[KEY.channel(id)] as ChannelRecord | undefined;
  return out;
}

export async function getVmap(): Promise<Record<string, string>> {
  const { vmap } = await local().get(KEY.vmap);
  return (vmap as Record<string, string>) ?? {};
}

export const today = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export async function getCheckStats(): Promise<CheckStats> {
  const { checks } = await local().get(KEY.checks);
  const c = checks as CheckStats | undefined;
  return c && c.day === today() ? c : { day: today(), count: 0, backoffUntil: c?.backoffUntil };
}

export async function getTodayCount(): Promise<number> {
  const { stats } = await local().get(KEY.stats);
  const s = stats as DailyStats | undefined;
  return s && s.day === today() ? s.ids.length : 0;
}
