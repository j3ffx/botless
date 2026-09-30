// @vitest-environment happy-dom
// The content script must not act on page events before it has loaded the user's settings: until then it only
// knows the defaults (Botless on), even if the user switched it off.
import { afterEach, describe, expect, it, vi } from 'vitest';

const VID = 'ZneqyXsgpO4';
const CID = 'UCZy_1WNgqZXMqrYeKoX-n1A';
const URL = `https://www.youtube.com/watch?v=${VID}`;

afterEach(() => vi.unstubAllGlobals());

describe('content script boot', () => {
  it('ignores page events that arrive before the settings are loaded', async () => {
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(URL);
    const sendMessage = vi.fn(async () => undefined);
    let release!: () => void;
    const storageReady = new Promise<void>((r) => (release = r));
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', sendMessage, onMessage: { addListener: vi.fn() } },
      storage: {
        // Slow storage: the user turned Botless off, but the script can't know yet.
        local: { get: vi.fn(async (key: string) => (await storageReady, key === 'settings' ? { settings: { enabled: false } } : {})) },
        onChanged: { addListener: vi.fn() },
      },
    });

    await import('../src/content/index');
    document.dispatchEvent(
      new CustomEvent('botless:page', { detail: JSON.stringify({ pageType: 'watch', url: URL, videoId: VID, channelId: CID, disclosure: 'ai' }) }),
    );
    await new Promise((r) => setTimeout(r, 20));
    release();
    await new Promise((r) => setTimeout(r, 20));

    expect(sendMessage).not.toHaveBeenCalled(); // no observation recorded for a user who has Botless off
  });
});
