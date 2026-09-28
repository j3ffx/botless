// @vitest-environment happy-dom
// Simulates the extension being reloaded while a YouTube tab stays open: the old content script loses its
// chrome.* connection and must remove its UI and go quiet instead of throwing on every scan.
import { afterEach, describe, expect, it, vi } from 'vitest';

function fakeChrome() {
  const store: Record<string, unknown> = {
    overrides: { 'UCZy_1WNgqZXMqrYeKoX-n1A': { verdict: 'ai', at: 0 } },
  };
  return {
    runtime: {
      id: 'test-extension' as string | undefined,
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: { get: vi.fn(async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((k) => k in store).map((k) => [k, store[k]]))) },
      onChanged: { addListener: vi.fn() },
    },
  };
}

const nextFrame = () => new Promise((r) => setTimeout(r, 50));

describe('content script after the extension is reloaded', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('badges while connected, then removes its UI and stops calling chrome.* once orphaned', async () => {
    const chrome = fakeChrome();
    vi.stubGlobal('chrome', chrome);
    document.body.innerHTML =
      '<ytd-video-renderer data-botless-key="ZneqyXsgpO4|UCZy_1WNgqZXMqrYeKoX-n1A" data-botless-vid="ZneqyXsgpO4" ' +
      'data-botless-cid="UCZy_1WNgqZXMqrYeKoX-n1A"><ytd-thumbnail></ytd-thumbnail></ytd-video-renderer>';

    await import('../src/content/index');
    await nextFrame();
    expect(document.querySelectorAll('.botless-badge')).toHaveLength(1);

    // Extension reloaded: runtime.id disappears and every chrome.* call throws.
    chrome.runtime.id = undefined;
    const invalidated = () => {
      throw new Error('Extension context invalidated.');
    };
    chrome.runtime.sendMessage.mockImplementation(invalidated);
    chrome.storage.local.get.mockImplementation(invalidated);
    const callsBefore = chrome.storage.local.get.mock.calls.length;

    document.dispatchEvent(new CustomEvent('botless:scan'));
    await nextFrame();
    expect(document.querySelectorAll('.botless-badge')).toHaveLength(0);

    // Further events are ignored entirely: no more chrome.* calls, no throws.
    document.dispatchEvent(new CustomEvent('botless:scan'));
    document.dispatchEvent(new CustomEvent('botless:page', { detail: JSON.stringify({ pageType: 'watch', url: 'x', channelId: 'UCZy_1WNgqZXMqrYeKoX-n1A' }) }));
    await nextFrame();
    expect(chrome.storage.local.get.mock.calls.length).toBe(callsBefore);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
