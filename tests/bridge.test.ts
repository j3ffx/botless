// @vitest-environment happy-dom
// The MAIN-world bridge, loaded in a simulated YouTube page. Markup verified on live YouTube, 2026-09-30.
import { beforeAll, describe, expect, it } from 'vitest';
import { MADE_WITH_AI_SECTION, watchResponse } from './fixtures';

const CID = 'UCZy_1WNgqZXMqrYeKoX-n1A';
const happy = () => (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM;
const events: Record<string, unknown>[] = [];

async function until(cond: () => unknown, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const navigate = (url: string, response: unknown) => {
  happy().setURL(url);
  // Like YouTube: detail.response holds the navigation's data, whose .response is the page data.
  document.dispatchEvent(new CustomEvent('yt-navigate-finish', { detail: { response: { response } } }));
};

beforeAll(async () => {
  document.addEventListener('botless:page', (e) => events.push(JSON.parse((e as CustomEvent<string>).detail)));
  await import('../src/bridge/bridge');
});

describe('bridge: channel pages', () => {
  it('attributes Shorts tiles to the channel only on the visible channel page, and marks them inferred', async () => {
    const short = (id: string) => `<ytm-shorts-lockup-view-model><a href="/shorts/${id}">s</a></ytm-shorts-lockup-view-model>`;
    // YouTube keeps the page you came from (here: home) in the DOM, hidden.
    document.body.innerHTML =
      `<ytd-browse page-subtype="home" hidden>${short('aaaaaaaaaaa')}</ytd-browse>` +
      `<ytd-browse page-subtype="channels">${short('bbbbbbbbbbb')}</ytd-browse>`;
    navigate('https://www.youtube.com/@WeRCinephiles/shorts', { metadata: { channelMetadataRenderer: { externalId: CID, title: 'We R Cinephiles' } } });

    const tile = (id: string) => document.querySelector<HTMLElement>(`[data-botless-vid="${id}"]`);
    await until(() => tile('bbbbbbbbbbb')?.dataset.botlessCid);
    expect(tile('bbbbbbbbbbb')!.dataset.botlessCid).toBe(CID);
    expect(tile('bbbbbbbbbbb')!.dataset.botlessInferred).toBe('1'); // displayed, but not learned as a fact
    expect(tile('aaaaaaaaaaa')?.dataset.botlessCid).toBeUndefined(); // the hidden home page's Short stays unattributed
  });
});

describe('bridge: watch pages', () => {
  it("doesn't read a label from page data that belongs to another video", async () => {
    events.length = 0;
    document.body.innerHTML = '';
    const stale = { ...watchResponse(MADE_WITH_AI_SECTION), currentVideoEndpoint: { watchEndpoint: { videoId: 'TCp_fT90F5s' } } };
    navigate('https://www.youtube.com/watch?v=ZneqyXsgpO4', stale);
    await until(() => events.length);
    expect(events[0]).toMatchObject({ pageType: 'watch', videoId: 'ZneqyXsgpO4', disclosureSource: 'unknown' });
    expect(events[0]!.disclosure).toBeUndefined();
  });

  it('reads the label when the data is for this video', async () => {
    events.length = 0;
    const fresh = { ...watchResponse(MADE_WITH_AI_SECTION), currentVideoEndpoint: { watchEndpoint: { videoId: 'ZneqyXsgpO4' } } };
    navigate('https://www.youtube.com/watch?v=ZneqyXsgpO4', fresh);
    await until(() => events.length);
    expect(events[0]).toMatchObject({ videoId: 'ZneqyXsgpO4', disclosure: 'ai', disclosureSource: 'data' });
  });
});
