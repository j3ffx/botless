/** Export/import format. Import treats the file as untrusted: every field is validated or dropped. */
import { normalizeSettings, type Settings } from './settings';
import { CHANNEL_ID_RE, VIDEO_ID_RE } from './extract';
import type { ChannelRecord, Overrides } from './types';
import { MAX_VIDEOS_PER_CHANNEL } from './verdict';

export const BACKUP_APP = 'botless-youtube';
export const BACKUP_VERSION = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  settings: Settings;
  overrides: Overrides;
  channels: Record<string, ChannelRecord>;
}

export function makeBackup(settings: Settings, overrides: Overrides, channels: Record<string, ChannelRecord>, now = new Date()): Backup {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), settings, overrides, channels };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : undefined);

/** Valid marks only. Also used by the service worker to re-check what the options page sends it. */
export function cleanOverrides(raw: unknown): { overrides: Overrides; skipped: number } {
  const overrides: Overrides = {};
  let skipped = 0;
  for (const [id, o] of Object.entries(isObj(raw) ? raw : {})) {
    if (CHANNEL_ID_RE.test(id) && isObj(o) && (o.verdict === 'ai' || o.verdict === 'human')) {
      overrides[id] = { verdict: o.verdict, name: str(o.name), at: num(o.at, Date.now()) };
    } else skipped++;
  }
  return { overrides, skipped };
}

/** Valid channel records only, with at most MAX_VIDEOS_PER_CHANNEL (the newest) videos each. */
export function cleanChannels(raw: unknown): { channels: Record<string, ChannelRecord>; skipped: number } {
  const channels: Record<string, ChannelRecord> = {};
  let skipped = 0;
  for (const [id, c] of Object.entries(isObj(raw) ? raw : {})) {
    if (!CHANNEL_ID_RE.test(id) || !isObj(c) || !isObj(c.videos)) {
      skipped++;
      continue;
    }
    const valid = Object.entries(c.videos).filter((e): e is [string, 0 | 1] => VIDEO_ID_RE.test(e[0]) && (e[1] === 0 || e[1] === 1));
    const videos = Object.fromEntries(valid.slice(-MAX_VIDEOS_PER_CHANNEL)) as Record<string, 0 | 1>;
    const votes = isObj(c.votes) ? { ai: Math.max(0, num(c.votes.ai, 0)), human: Math.max(0, num(c.votes.human, 0)) } : undefined;
    // Cached verdicts are not imported; they are recomputed under the importing user's thresholds.
    channels[id] = { id, name: str(c.name), videos, votes, firstSeen: num(c.firstSeen, Date.now()), lastSeen: num(c.lastSeen, Date.now()) };
  }
  return { channels, skipped };
}

export function parseBackup(text: string): { ok: true; backup: Backup; skipped: number } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!isObj(raw) || raw.app !== BACKUP_APP) return { ok: false, error: 'That file is not a Botless export.' };
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    return { ok: false, error: 'That export comes from a newer version of Botless.' };
  }

  const { overrides, skipped: badMarks } = cleanOverrides(raw.overrides);
  const { channels, skipped: badChannels } = cleanChannels(raw.channels);
  const exported = new Date(str(raw.exportedAt) ?? Date.now());
  return {
    ok: true,
    skipped: badMarks + badChannels,
    backup: makeBackup(normalizeSettings(raw.settings), overrides, channels, Number.isNaN(exported.getTime()) ? new Date() : exported),
  };
}
