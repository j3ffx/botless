/** Export/import format. Import treats the file as untrusted: every field is validated or dropped. */
import { normalizeSettings, type Settings } from './settings';
import { CHANNEL_ID_RE, VIDEO_ID_RE } from './extract';
import type { ChannelRecord, Overrides } from './types';

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

  let skipped = 0;
  const overrides: Overrides = {};
  for (const [id, o] of Object.entries(isObj(raw.overrides) ? raw.overrides : {})) {
    if (CHANNEL_ID_RE.test(id) && isObj(o) && (o.verdict === 'ai' || o.verdict === 'human')) {
      overrides[id] = { verdict: o.verdict, name: str(o.name), at: num(o.at, Date.now()) };
    } else skipped++;
  }

  const channels: Record<string, ChannelRecord> = {};
  for (const [id, c] of Object.entries(isObj(raw.channels) ? raw.channels : {})) {
    if (!CHANNEL_ID_RE.test(id) || !isObj(c) || !isObj(c.videos)) {
      skipped++;
      continue;
    }
    const videos: Record<string, 0 | 1> = {};
    for (const [vid, f] of Object.entries(c.videos)) if (VIDEO_ID_RE.test(vid) && (f === 0 || f === 1)) videos[vid] = f;
    const votes = isObj(c.votes) ? { ai: Math.max(0, num(c.votes.ai, 0)), human: Math.max(0, num(c.votes.human, 0)) } : undefined;
    // Cached verdicts are not imported; they are recomputed under the importing user's thresholds.
    channels[id] = { id, name: str(c.name), videos, votes, firstSeen: num(c.firstSeen, Date.now()), lastSeen: num(c.lastSeen, Date.now()) };
  }

  return {
    ok: true,
    skipped,
    backup: makeBackup(normalizeSettings(raw.settings), overrides, channels, new Date(str(raw.exportedAt) ?? Date.now())),
  };
}
