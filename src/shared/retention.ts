/**
 * How much channel data to keep. PURE: the service worker measures storage and applies the result.
 *
 * Channel records are forgotten after observationTtlDays, but that alone doesn't bound their size: with Active
 * mode checking hundreds of new channels a day, chrome.storage.local's quota (10 MB, 5 MB before Chrome 114)
 * can fill up, after which every write fails. Past HIGH of the quota, the least recently seen channels are
 * dropped until usage is back under LOW. The user's own marks live elsewhere and are never touched.
 */
export const STORAGE_HIGH = 0.7;
export const STORAGE_LOW = 0.5;
/** Age-based purge: at most this often (the service worker starts many times a day). */
export const PURGE_EVERY_MS = 86_400_000;

export interface SizedRecord {
  key: string;
  lastSeen: number;
  /** Approximate bytes this entry uses (key + JSON value, as chrome.storage counts it). */
  bytes: number;
}

export const entryBytes = (key: string, value: unknown): number => key.length + JSON.stringify(value ?? null).length;

/** Keys to delete, least recently seen first, to bring `used` bytes under LOW of `quota`. Empty if under HIGH. */
export function keysToEvict(records: SizedRecord[], used: number, quota: number): string[] {
  if (used < quota * STORAGE_HIGH) return [];
  let toFree = used - quota * STORAGE_LOW;
  const out: string[] = [];
  for (const r of [...records].sort((a, b) => a.lastSeen - b.lastSeen)) {
    if (toFree <= 0) break;
    out.push(r.key);
    toFree -= r.bytes;
  }
  return out;
}
