// @vitest-environment happy-dom
// A change to one channel's data must only re-render that channel's tiles, not every badge on the page.
import { afterEach, describe, expect, it, vi } from 'vitest';

const A = 'UCZy_1WNgqZXMqrYeKoX-n1A';
const B = 'UCHnyfMqiRRG1u-2MsSQLbXA';
/** Waits for a condition instead of a fixed delay: rendering goes through storage, a load timer and frames. */
async function until(cond: () => unknown, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('tile rendering', () => {
  it('re-renders only the tiles of the channel whose data changed', async () => {
    const listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
    const store: Record<string, unknown> = {
      // Two labeled videos each: "Probably AI" by the default thresholds.
      [`c:${A}`]: { id: A, videos: { vvvvvvvvvv1: 1, vvvvvvvvvv2: 1 }, firstSeen: 0, lastSeen: 0 },
      [`c:${B}`]: { id: B, videos: { wwwwwwwwww1: 1, wwwwwwwwww2: 1 }, firstSeen: 0, lastSeen: 0 },
    };
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', sendMessage: vi.fn(async () => undefined), onMessage: { addListener: vi.fn() } },
      storage: {
        local: { get: vi.fn(async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((k) => k in store).map((k) => [k, store[k]]))) },
        onChanged: { addListener: (fn: (typeof listeners)[number]) => listeners.push(fn) },
      },
    });
    const tile = (vid: string, cid: string) =>
      `<ytd-video-renderer data-botless-key="${vid}|${cid}" data-botless-vid="${vid}" data-botless-cid="${cid}"><ytd-thumbnail></ytd-thumbnail></ytd-video-renderer>`;
    document.body.innerHTML = tile('aaaaaaaaaaa', A) + tile('bbbbbbbbbbb', B);

    await import('../src/content/index');
    const badge = (cid: string) => document.querySelector(`[data-botless-cid="${cid}"] .botless-badge`);
    await until(() => badge(A) && badge(B));
    const [a0, b0] = [badge(A), badge(B)];
    expect(a0 && b0).toBeTruthy();

    // Channel A gets a new observation (what every background check does).
    const recA = { id: A, videos: { vvvvvvvvvv1: 1, vvvvvvvvvv2: 1, ccccccccccc: 1 }, firstSeen: 0, lastSeen: 1 };
    store[`c:${A}`] = recA;
    for (const l of listeners) l({ [`c:${A}`]: { newValue: recA } }, 'local');
    await until(() => badge(A) !== a0); // A's tile is refreshed (its tooltip reasons may have changed)
    await new Promise((r) => setTimeout(r, 50)); // let any other re-render happen too

    expect(badge(B)).toBe(b0); // B's badge is untouched
  });
});
