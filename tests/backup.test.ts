import { describe, expect, it } from 'vitest';
import { makeBackup, parseBackup } from '../src/shared/backup';
import { MAX_VIDEOS_PER_CHANNEL } from '../src/shared/verdict';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const CID = 'UCHnyfMqiRRG1u-2MsSQLbXA';

describe('backup', () => {
  it('round-trips', () => {
    const b = makeBackup(
      DEFAULT_SETTINGS,
      { [CID]: { verdict: 'ai', name: 'V', at: 5 } },
      { [CID]: { id: CID, videos: { JsBZOcqZerk: 1 }, firstSeen: 1, lastSeen: 2 } },
    );
    const p = parseBackup(JSON.stringify(b));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.backup.overrides[CID]!.verdict).toBe('ai');
    expect(p.backup.channels[CID]!.videos).toEqual({ JsBZOcqZerk: 1 });
  });

  it('rejects foreign or broken files', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{"app":"other"}').ok).toBe(false);
    expect(parseBackup('{"app":"botless-youtube","version":99}').ok).toBe(false);
  });

  it('drops invalid entries and clamps settings', () => {
    const p = parseBackup(
      JSON.stringify({
        app: 'botless-youtube',
        version: 1,
        settings: { thresholds: { aiRatio: 7 }, actions: { human: 'hide' } },
        overrides: { notAChannel: { verdict: 'ai' }, [CID]: { verdict: 'maybe' } },
        channels: { [CID]: { videos: { JsBZOcqZerk: 1, bad: 1, ZDB05cTiDUg: 'x' } } },
      }),
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.skipped).toBe(2);
    expect(p.backup.settings.thresholds.aiRatio).toBe(1);
    expect(p.backup.settings.actions.human).toBe('none');
    expect(p.backup.channels[CID]!.videos).toEqual({ JsBZOcqZerk: 1 });
  });

  it('survives a garbage export date instead of throwing', () => {
    const p = parseBackup(JSON.stringify({ app: 'botless-youtube', version: 1, exportedAt: 'not a date' }));
    expect(p.ok).toBe(true);
    if (p.ok) expect(Number.isNaN(Date.parse(p.backup.exportedAt))).toBe(false);
  });

  it('keeps at most the newest MAX_VIDEOS_PER_CHANNEL videos per channel', () => {
    const videos = Object.fromEntries(Array.from({ length: MAX_VIDEOS_PER_CHANNEL + 50 }, (_, i) => [`v${String(i).padStart(10, '0')}`, 0]));
    const p = parseBackup(JSON.stringify({ app: 'botless-youtube', version: 1, channels: { [CID]: { videos } } }));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const kept = Object.keys(p.backup.channels[CID]!.videos);
    expect(kept).toHaveLength(MAX_VIDEOS_PER_CHANNEL);
    expect(kept.at(-1)).toBe(`v${String(MAX_VIDEOS_PER_CHANNEL + 49).padStart(10, '0')}`); // the newest are kept
  });
});
