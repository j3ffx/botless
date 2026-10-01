// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChecker } from '../src/content/checker';
import type { SwRequest } from '../src/shared/messages';
import type { ChannelRecord, Override } from '../src/shared/types';
import { addObservation } from '../src/shared/verdict';
import { MADE_WITH_AI_SECTION, watchResponse } from './fixtures';

const CID = 'UCZy_1WNgqZXMqrYeKoX-n1A';

/** A /youtubei/v1/next response owned by `channelId`, labeled or not. */
const nextJson = (channelId: string, labeled: boolean) => ({
  ...watchResponse(...(labeled ? [MADE_WITH_AI_SECTION] : [])),
  contents: {
    twoColumnWatchNextResults: {
      results: {
        results: {
          contents: [
            {
              videoSecondaryInfoRenderer: {
                owner: {
                  videoOwnerRenderer: {
                    title: { runs: [{ text: 'We R Cinephiles' }] },
                    navigationEndpoint: { browseEndpoint: { browseId: channelId } },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
});

const feedXml = (...ids: string[]) => `<feed>${ids.map((id) => `<entry><yt:videoId>${id}</yt:videoId></entry>`).join('')}</feed>`;

/** Fake service worker + YouTube. `labels` says which video IDs carry the AI label. */
function setup(opts: {
  labels: Record<string, boolean>;
  feed?: string[];
  permit?: () => object;
  status?: number;
  /** HTTP status of the channel feed (YouTube's RSS feeds fail with 404 or 5xx now and then). */
  feedStatus?: number;
  throws?: boolean;
  /** The page is left mid-request (reload, full navigation): the browser aborts the fetch. */
  leaves?: boolean;
  /** Same, but Chrome rejects the fetch first and fires pagehide a moment later (typed URL, bookmark). */
  leavesLate?: boolean;
  /**
   * The content script's copy of a record catches up only when chrome.storage.onChanged fires, which can be
   * after the service worker's reply. Simulates that lag.
   */
  lagMs?: number;
  overrides?: Record<string, Override>;
}) {
  const records: Record<string, ChannelRecord> = {};
  const sent: SwRequest[] = [];
  const fetched: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit'); // never with the user's cookies
      expect(init?.redirect).toBe('error'); // never follow YouTube to another host
      if (opts.leaves) dispatchEvent(new Event('pagehide'));
      if (opts.leavesLate) setTimeout(() => dispatchEvent(new Event('pagehide')), 150);
      if (opts.throws || opts.leaves || opts.leavesLate) throw new TypeError('Failed to fetch');
      if (url.includes('/feeds/videos.xml')) {
        fetched.push('feed');
        if (opts.feedStatus) return new Response('', { status: opts.feedStatus });
        return new Response(feedXml(...(opts.feed ?? [])), { status: 200 });
      }
      const { videoId } = JSON.parse(String(init?.body));
      fetched.push(videoId);
      if (opts.status) return new Response('', { status: opts.status });
      return new Response(JSON.stringify(nextJson(CID, !!opts.labels[videoId])), { status: 200 });
    }),
  );

  const send = vi.fn(async (msg: SwRequest) => {
    sent.push(msg);
    if (msg.type === 'checkPermit') return opts.permit ? opts.permit() : { ok: true };
    if (msg.type === 'observe') {
      records[msg.channelId] = addObservation(records[msg.channelId], msg, Date.now());
      const record = records[msg.channelId]!;
      if (opts.lagMs) setTimeout(() => (seen[msg.channelId] = record), opts.lagMs);
      else seen[msg.channelId] = record;
      return { channelId: msg.channelId, record, result: { verdict: null, score: 0, reasons: [] } };
    }
  });

  /** What the content script's cache holds (lags behind `records` with `lagMs`). */
  const seen: Record<string, ChannelRecord> = {};
  const checker = createChecker({
    send,
    record: (cid) => seen[cid],
    override: (cid) => opts.overrides?.[cid],
    active: () => true,
  });
  return { checker, records, sent, fetched };
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  dispatchEvent(new Event('pageshow')); // every checker built so far listens: undo a test's pagehide
});

describe('background checker', () => {
  it('checks the tile video, then confirms a label with one more video from the channel feed', async () => {
    const { checker, records, fetched } = setup({
      labels: { ZneqyXsgpO4: true, TCp_fT90F5s: true },
      feed: ['ZneqyXsgpO4', 'TCp_fT90F5s', 'D1hIn4SA-q4'],
    });
    checker.offer('ZneqyXsgpO4', CID);
    await until(() => Object.keys(records[CID]?.videos ?? {}).length === 2);
    expect(fetched).toEqual(['ZneqyXsgpO4', 'feed', 'TCp_fT90F5s']); // skips the already-checked feed entry
    expect(records[CID]!.videos).toEqual({ ZneqyXsgpO4: 1, TCp_fT90F5s: 1 }); // 2 of 2 -> "Probably AI" by scoring
  });

  it("still confirms a label when the page's copy of the record catches up after the reply", async () => {
    const { checker, records, fetched } = setup({
      labels: { ZneqyXsgpO4: true, TCp_fT90F5s: true },
      feed: ['TCp_fT90F5s'],
      lagMs: 30,
    });
    checker.offer('ZneqyXsgpO4', CID);
    await until(() => Object.keys(records[CID]?.videos ?? {}).length === 2);
    expect(fetched).toEqual(['ZneqyXsgpO4', 'feed', 'TCp_fT90F5s']); // before the fix: the confirmation was dropped
  });

  it('checks a Short whose tile has no channel, learning its channel and label', async () => {
    const { checker, records, sent, fetched } = setup({ labels: { ZneqyXsgpO4: true }, feed: [] });
    checker.offer('ZneqyXsgpO4', null);
    // Labeled -> it then reads the channel feed to confirm (empty here). Wait for that so it can't leak into other tests.
    await until(() => fetched.includes('feed'));
    expect(records[CID]!.videos).toEqual({ ZneqyXsgpO4: 1 }); // attributed to the channel from the response
    expect(sent).toContainEqual({ type: 'learnVideos', pairs: [['ZneqyXsgpO4', CID]] }); // the tile can now be judged
  });

  it('stops after one unlabeled video (no confirmation needed)', async () => {
    const { checker, records, fetched } = setup({ labels: {} });
    checker.offer('JsBZOcqZerk', CID);
    await until(() => !!records[CID]);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetched).toEqual(['JsBZOcqZerk']);
    expect(records[CID]!.videos).toEqual({ JsBZOcqZerk: 0 });
  });

  it('never checks channels the user marked', async () => {
    const { checker, fetched, sent } = setup({ labels: {}, overrides: { [CID]: { verdict: 'human', at: 0 } } });
    checker.offer('JsBZOcqZerk', CID);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetched).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('waits for a slot from the service worker before any request', async () => {
    let calls = 0;
    const { checker, fetched } = setup({
      labels: {},
      permit: () => (++calls < 3 ? { ok: false, retryAfterMs: 20, reason: 'spacing' } : { ok: true }),
    });
    checker.offer('JsBZOcqZerk', CID);
    await until(() => fetched.length === 1);
    expect(calls).toBe(3);
  });

  it('waits a minute, instead of looping, when the service worker answers with an error', async () => {
    let calls = 0;
    const { checker, fetched } = setup({ labels: {}, permit: () => (calls++, { error: 'QUOTA_BYTES quota exceeded' }) });
    checker.offer('JsBZOcqZerk', CID);
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(1); // before the fix: thousands of calls, one per tick
    expect(fetched).toEqual([]);
    checker.stop();
  });

  it('reports YouTube push-back so the service worker can pause everyone, and records nothing', async () => {
    const { checker, records, sent } = setup({ labels: {}, status: 429 });
    checker.offer('JsBZOcqZerk', CID);
    await until(() => sent.some((m) => m.type === 'checkFailed'));
    expect(sent.find((m) => m.type === 'checkFailed')).toEqual({ type: 'checkFailed', status: 429 });
    expect(records[CID]).toBeUndefined();
  });

  it('backs off on a redirect or network error instead of silently retrying', async () => {
    const { checker, records, sent } = setup({ labels: {}, throws: true });
    checker.offer('JsBZOcqZerk', CID);
    await until(() => sent.some((m) => m.type === 'checkFailed'));
    expect(sent.find((m) => m.type === 'checkFailed')).toEqual({ type: 'checkFailed', status: 0 });
    expect(records[CID]).toBeUndefined();
  });

  it('does not pause everyone when the request only failed because the page was being left', async () => {
    const { checker, fetched, sent } = setup({ labels: {}, leaves: true });
    checker.offer('JsBZOcqZerk', CID);
    await until(() => sent.some((m) => m.type === 'checkPermit'));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetched).toEqual([]);
    expect(sent.map((m) => m.type)).toEqual(['checkPermit']); // before the fix: a 15-minute pause for every tab
  });

  it('does not pause everyone either when the page is left just after the request failed', async () => {
    const { checker, sent } = setup({ labels: {}, leavesLate: true });
    checker.offer('JsBZOcqZerk', CID);
    await until(() => sent.some((m) => m.type === 'checkPermit'));
    await new Promise((r) => setTimeout(r, 1500));
    expect(sent.map((m) => m.type)).toEqual(['checkPermit']); // before the fix: checkFailed, sent before pagehide
  });

  it("doesn't pause everyone when a channel feed is down, only skips that confirmation", async () => {
    for (const feedStatus of [404, 500, 503]) {
      const { checker, fetched, sent } = setup({ labels: { ZneqyXsgpO4: true }, feedStatus });
      checker.offer('ZneqyXsgpO4', CID);
      await until(() => fetched.includes('feed'));
      await new Promise((r) => setTimeout(r, 50));
      expect(sent.filter((m) => m.type === 'checkFailed')).toEqual([]); // before the fix: a 15-minute pause for 5xx
    }
  });

  it('still pauses everyone when the feed says YouTube is pushing back', async () => {
    for (const feedStatus of [429, 403]) {
      const { checker, sent } = setup({ labels: { ZneqyXsgpO4: true }, feedStatus });
      checker.offer('ZneqyXsgpO4', CID);
      await until(() => sent.some((m) => m.type === 'checkFailed'));
      expect(sent.find((m) => m.type === 'checkFailed')).toEqual({ type: 'checkFailed', status: feedStatus });
    }
  });

  it('handles the newest offer first and never re-checks a video in the same tab', async () => {
    const { checker, fetched } = setup({ labels: {} });
    const OTHER = 'UCHnyfMqiRRG1u-2MsSQLbXA';
    checker.offer('aaaaaaaaaaa', OTHER);
    checker.offer('bbbbbbbbbbb', CID);
    await until(() => fetched.length >= 1);
    expect(fetched[0]).toBe('bbbbbbbbbbb');
    checker.offer('bbbbbbbbbbb', CID);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetched.filter((v) => v === 'bbbbbbbbbbb')).toHaveLength(1);
  });
});
