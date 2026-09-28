/**
 * Service worker: the single writer for channel data, overrides, the video->channel map and stats.
 * Every mutation runs through `serial()` so read-modify-write cycles from several tabs never interleave.
 * No network access: phase 1 keeps everything in chrome.storage.local.
 */
import type { ChannelSummary, SwRequest } from '../shared/messages';
import { DEFAULT_SETTINGS } from '../shared/settings';
import {
  getChannels,
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
  }
}

chrome.runtime.onMessage.addListener((msg: SwRequest, _sender, reply) => {
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

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await local.set({ [KEY.settings]: DEFAULT_SETTINGS });
  await purge();
});
chrome.runtime.onStartup.addListener(() => void purge());
