/**
 * Service worker: the single writer for channel data, overrides, the video->channel map and stats.
 * Every mutation runs through `serial()` so read-modify-write cycles from several tabs never interleave.
 * It never makes network requests. It also rate-limits the opt-in background checks for all tabs
 * (checkPermit); the checks themselves are fetched by the content script (src/content/checker.ts).
 */
import { CHECK_BACKOFF_MS, CHECK_SPACING_MS } from '../shared/check';
import type { ChannelSummary, CheckPermit, SwRequest } from '../shared/messages';
import { checksOn, DEFAULT_SETTINGS } from '../shared/settings';
import { parseSwRequest } from '../shared/validate';
import {
  getChannels,
  getCheckStats,
  getOverrides,
  getSettings,
  getVmap,
  isChannelKey,
  KEY,
  STATS_MAX_IDS,
  today,
  VMAP_MAX,
} from '../shared/storage';
import type { ChannelRecord, DailyStats } from '../shared/types';
import { addObservation, resolveVerdict, withFreshCache } from '../shared/verdict';

const local = chrome.storage.local;
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};

async function summary(channelId: string): Promise<ChannelSummary> {
  const [settings, overrides, recs] = await Promise.all([getSettings(), getOverrides(), getChannels([channelId])]);
  const record = recs[channelId];
  const override = overrides[channelId];
  return { channelId, record, override, result: resolveVerdict(record, override, settings, Date.now()).result };
}

async function handle(msg: SwRequest): Promise<unknown> {
  switch (msg.type) {
    case 'observe':
      return serial(async () => {
        const settings = await getSettings();
        const now = Date.now();
        const prev = (await getChannels([msg.channelId]))[msg.channelId];
        const same = prev?.videos[msg.videoId] === (msg.labeled ? 1 : 0);
        // Re-watching the same video changes nothing but lastSeen; skip the write unless the cache is due.
        if (!(same && prev?.cached && now - prev.lastSeen < 3_600_000)) {
          const next = withFreshCache(addObservation(prev, msg, now), settings, now);
          await local.set({ [KEY.channel(msg.channelId)]: next });
        }
        return summary(msg.channelId);
      });

    case 'refresh':
      return serial(async () => {
        const settings = await getSettings();
        const now = Date.now();
        const recs = await getChannels(msg.channelIds.slice(0, 200));
        const out: Record<string, ChannelRecord> = {};
        for (const [id, rec] of Object.entries(recs)) if (rec) out[KEY.channel(id)] = withFreshCache(rec, settings, now);
        if (Object.keys(out).length) await local.set(out);
      });

    case 'setOverride':
      return serial(async () => {
        const overrides = await getOverrides();
        if (msg.verdict) overrides[msg.channelId] = { verdict: msg.verdict, name: msg.name, at: Date.now() };
        else delete overrides[msg.channelId];
        await local.set({ [KEY.overrides]: overrides });
        return summary(msg.channelId);
      });

    case 'vote':
      // Phase 2: community votes need a server. Phase 1 sends nothing anywhere, so voting is disabled.
      return { ok: false, reason: 'Community voting arrives in phase 2.' };

    case 'flagged':
      return serial(async () => {
        const { stats } = await local.get(KEY.stats);
        const day = today();
        const s: DailyStats = (stats as DailyStats)?.day === day ? (stats as DailyStats) : { day, ids: [] };
        const set = new Set(s.ids);
        for (const id of msg.videoIds) if (set.size < STATS_MAX_IDS) set.add(id);
        if (set.size !== s.ids.length || s.day !== (stats as DailyStats)?.day) await local.set({ [KEY.stats]: { day, ids: [...set] } });
      });

    case 'learnVideos':
      return serial(async () => {
        const vmap = await getVmap();
        let changed = false;
        for (const [vid, cid] of msg.pairs) {
          if (vmap[vid] === cid) continue;
          delete vmap[vid];
          vmap[vid] = cid;
          changed = true;
        }
        if (!changed) return;
        const keys = Object.keys(vmap);
        for (let i = 0; i < keys.length - VMAP_MAX; i++) delete vmap[keys[i]!];
        await local.set({ [KEY.vmap]: vmap });
      });

    case 'getChannel':
      return summary(msg.channelId);

    case 'checkPermit':
      return serial(() => checkPermit());

    case 'checkFailed':
      // Rate limited, blocked, redirected or unreachable (status 0), or YouTube having trouble: pause everyone.
      if (msg.status === 0 || msg.status === 429 || msg.status === 403 || msg.status >= 500) {
        return serial(async () => {
          const stats = await getCheckStats();
          await local.set({ [KEY.checks]: { ...stats, backoffUntil: Date.now() + CHECK_BACKOFF_MS } });
        });
      }
      return;
  }
}

/** In memory: the SW may restart, which at worst allows one early request. The daily count is persisted. */
let lastGrant = 0;

async function checkPermit(): Promise<CheckPermit> {
  const settings = await getSettings();
  if (!checksOn(settings)) return { ok: false, retryAfterMs: 60_000, reason: 'off' };
  const now = Date.now();
  const stats = await getCheckStats();
  if (stats.backoffUntil && stats.backoffUntil > now) return { ok: false, retryAfterMs: stats.backoffUntil - now, reason: 'backoff' };
  if (stats.count >= settings.checkDailyLimit) return { ok: false, retryAfterMs: 30 * 60_000, reason: 'cap' };
  const wait = lastGrant + CHECK_SPACING_MS - now;
  if (wait > 0) return { ok: false, retryAfterMs: wait, reason: 'spacing' };
  lastGrant = now;
  await local.set({ [KEY.checks]: { ...stats, count: stats.count + 1 } });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, reply) => {
  // Only Botless's own pages and content scripts; web pages can't reach us (no externally_connectable) anyway.
  if (sender.id !== chrome.runtime.id) return false;
  // Rebuilt from validated fields only: a compromised content script can't write arbitrary data to storage.
  const msg = parseSwRequest(raw);
  if (!msg) {
    reply({ error: 'invalid request' });
    return false;
  }
  handle(msg).then(reply, (err) => reply({ error: String(err) }));
  return true; // async reply
});

/** Forget channels not seen for observationTtlDays. Overrides live elsewhere and are never purged. */
async function purge(): Promise<void> {
  await serial(async () => {
    const settings = await getSettings();
    const cutoff = Date.now() - settings.observationTtlDays * 86_400_000;
    const all = await local.get(null);
    const stale = Object.entries(all)
      .filter(([k, v]) => isChannelKey(k) && ((v as ChannelRecord).lastSeen ?? 0) < cutoff)
      .map(([k]) => k);
    if (stale.length) await local.remove(stale);
  });
}

/** Storage keys of removed features, deleted on update so nothing stale lingers on the user's device. */
const OBSOLETE_KEYS = ['dontrec']; // the removed "Don't recommend channel" feature (2026-09-29)

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await local.set({ [KEY.settings]: DEFAULT_SETTINGS });
  if (reason === 'update') await local.remove(OBSOLETE_KEYS);
  await purge();
});
chrome.runtime.onStartup.addListener(() => void purge());
