// @vitest-environment happy-dom
// With Botless switched off, the content script must not learn anything from the page, including which channel
// each tile's video belongs to (the bridge keeps stamping tiles: it can't read the settings).
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('content script with Botless off', () => {
  it('learns no video → channel pairs from the tiles', async () => {
    const sendMessage = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', sendMessage, onMessage: { addListener: vi.fn() } },
      storage: {
        local: { get: vi.fn(async (key: string) => (key === 'settings' ? { settings: { enabled: false } } : {})) },
        onChanged: { addListener: vi.fn() },
      },
    });
    const tile = document.createElement('ytd-video-renderer');
    Object.assign(tile.dataset, { botlessKey: '/watch?v=ZneqyXsgpO4', botlessVid: 'ZneqyXsgpO4', botlessCid: 'UCZy_1WNgqZXMqrYeKoX-n1A' });
    document.body.append(tile);

    await import('../src/content/index');
    document.dispatchEvent(new CustomEvent('botless:scan'));
    await new Promise((r) => setTimeout(r, 2_300)); // past the 2 s batch that would send the pairs

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
