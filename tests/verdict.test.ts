import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { ChannelRecord } from '../src/shared/types';
import { addObservation, MAX_VIDEOS_PER_CHANNEL, resolveVerdict, withFreshCache, withVideoLabel } from '../src/shared/verdict';

const CID = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const DAY = 86_400_000;
const s = DEFAULT_SETTINGS;

function recordWith(labeled: number, plain: number, now = 0): ChannelRecord {
  let r: ChannelRecord | undefined;
  for (let i = 0; i < labeled + plain; i++) {
    r = addObservation(r, { channelId: CID, videoId: `vid${String(i).padStart(8, '0')}`, labeled: i < labeled }, now);
  }
  return r!;
}

describe('observations', () => {
  it('records and de-duplicates videos', () => {
    let r = addObservation(undefined, { channelId: CID, name: 'X', videoId: 'aaaaaaaaaaa', labeled: false }, 1);
    r = addObservation(r, { channelId: CID, videoId: 'aaaaaaaaaaa', labeled: true }, 2);
    expect(r.videos).toEqual({ aaaaaaaaaaa: 1 });
    expect(r.name).toBe('X');
    expect([r.firstSeen, r.lastSeen]).toEqual([1, 2]);
  });

  it('keeps only the newest videos', () => {
    const r = recordWith(0, MAX_VIDEOS_PER_CHANNEL + 5);
    expect(Object.keys(r.videos)).toHaveLength(MAX_VIDEOS_PER_CHANNEL);
    expect(r.videos['vid00000000']).toBeUndefined();
  });
});

describe('resolveVerdict cache + TTL', () => {
  it('computes and flags stale when there is no cache', () => {
    const { result, stale } = resolveVerdict(recordWith(3, 0), undefined, s, 0);
    expect(result.verdict).toBe('ai');
    expect(stale).toBe(true);
  });

  it('uses a fresh cache', () => {
    const cached = withFreshCache(recordWith(3, 0), s, 0);
    cached.cached!.verdict = 'inconclusive'; // prove the cache, not a recompute, is used
    expect(resolveVerdict(cached, undefined, s, DAY).result.verdict).toBe('inconclusive');
  });

  it('expires the cache after cacheTtlDays', () => {
    const cached = withFreshCache(recordWith(3, 0), s, 0);
    cached.cached!.verdict = 'inconclusive';
    const r = resolveVerdict(cached, undefined, s, (s.cacheTtlDays + 1) * DAY);
    expect(r).toMatchObject({ stale: true, result: { verdict: 'ai' } });
  });

  it('invalidates the cache when thresholds change', () => {
    const cached = withFreshCache(recordWith(8, 2), s, 0); // 80%: inconclusive at the default 90%
    const looser = { ...s, thresholds: { ...s.thresholds, aiRatio: 0.75 } };
    expect(resolveVerdict(cached, undefined, looser, 1).result.verdict).toBe('ai');
  });

  it('treats a single labeled video as AI for that video, without changing the channel verdict', () => {
    const channel = resolveVerdict(recordWith(1, 0), undefined, s, 0).result; // 1 of 1 labeled -> Inconclusive
    expect(channel.verdict).toBe('inconclusive');
    const video = withVideoLabel(channel, true, undefined);
    expect(video.verdict).toBe('ai');
    expect(video.reasons[0]!.text).toBe("This video carries YouTube's AI label");
    expect(withVideoLabel(channel, false, undefined)).toBe(channel);
    expect(withVideoLabel(channel, true, { verdict: 'human', at: 0 })).toBe(channel); // the user's mark wins
  });

  it('lets an override beat the cache', () => {
    const cached = withFreshCache(recordWith(3, 0), s, 0);
    expect(resolveVerdict(cached, { verdict: 'human', at: 0 }, s, 1).result.verdict).toBe('human');
  });
});
