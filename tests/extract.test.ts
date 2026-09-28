import { describe, expect, it } from 'vitest';
import {
  channelIdFromChannelPage,
  channelIdFromRendererData,
  findChannelBrowseId,
  soleChannel,
  videoIdFromHref,
  videoIdFromRendererData,
} from '../src/shared/extract';
import { LOCKUP_DATA, SEARCH_VIDEO_DATA, SHORTS_SHELF_ITEM } from './fixtures';

const VERITASIUM = 'UCHnyfMqiRRG1u-2MsSQLbXA';

describe('channel ID extraction', () => {
  it('reads classic renderer owner fields', () => {
    expect(channelIdFromRendererData(SEARCH_VIDEO_DATA)).toBe(VERITASIUM);
  });

  it('reads new lockup view models', () => {
    expect(channelIdFromRendererData(LOCKUP_DATA)).toBe(VERITASIUM);
  });

  it('never mistakes tracking params for a channel ID (Shorts shelves have no channel)', () => {
    expect(JSON.stringify(SHORTS_SHELF_ITEM)).toMatch(/UC[\w-]{22}/);
    expect(channelIdFromRendererData(SHORTS_SHELF_ITEM)).toBeNull();
    expect(findChannelBrowseId(SHORTS_SHELF_ITEM)).toBeNull();
  });

  it('rejects non-channel browse IDs (playlists, FE pages)', () => {
    expect(findChannelBrowseId({ browseEndpoint: { browseId: 'VLPL1234567890123456789012' } })).toBeNull();
    expect(findChannelBrowseId({ browseEndpoint: { browseId: 'FEwhat_to_watch' } })).toBeNull();
  });

  it('finds the one channel a shelf is about ("Latest from X" in search)', () => {
    const run = (id: string, text: string) => ({ text, navigationEndpoint: { browseEndpoint: { browseId: id } } });
    const shelf = (...owners: [string, string][]) => ({
      title: { runs: [{ text: 'Latest from We R Cinephiles' }] },
      content: {
        verticalListRenderer: {
          items: owners.map(([id, name]) => ({
            videoRenderer: { videoId: 'abcdefghijk', ownerText: { runs: [run(id, name)] }, longBylineText: { runs: [run(id, name)] } },
          })),
        },
      },
    });
    const CIN = 'UCZy_1WNgqZXMqrYeKoX-n1A';
    expect(soleChannel(shelf([CIN, 'We R Cinephiles'], [CIN, 'We R Cinephiles']))).toEqual({ id: CIN, name: 'We R Cinephiles' });
    expect(soleChannel(shelf([CIN, 'We R Cinephiles'], [VERITASIUM, 'Veritasium']))).toBeNull(); // mixed shelf
    expect(soleChannel({})).toBeNull();
    // The name must come from a link to the channel, not e.g. a hashtag link that happens to come first.
    const withHashtag = { a: { text: '#music', navigationEndpoint: { browseEndpoint: { browseId: 'FEhashtag' } } }, b: shelf([CIN, 'We R Cinephiles']) };
    expect(soleChannel(withHashtag)?.name).toBe('We R Cinephiles');
  });

  it('reads the channel page metadata', () => {
    const page = { metadata: { channelMetadataRenderer: { externalId: VERITASIUM, title: 'Veritasium' } } };
    expect(channelIdFromChannelPage(page)).toBe(VERITASIUM);
    expect(channelIdFromChannelPage({})).toBeNull();
  });
});

describe('video ID extraction', () => {
  it('reads data fields', () => {
    expect(videoIdFromRendererData(SEARCH_VIDEO_DATA)).toBe('JsBZOcqZerk');
    expect(videoIdFromRendererData(LOCKUP_DATA)).toBe('onr80iOoEXs');
    expect(videoIdFromRendererData({ contentId: 'PLabcdefghi', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' })).toBeNull();
  });

  it('reads hrefs', () => {
    expect(videoIdFromHref('/watch?v=JsBZOcqZerk&t=256s')).toBe('JsBZOcqZerk');
    expect(videoIdFromHref('/watch?list=PL1&v=JsBZOcqZerk')).toBe('JsBZOcqZerk');
    expect(videoIdFromHref('/shorts/ZDB05cTiDUg')).toBe('ZDB05cTiDUg');
    expect(videoIdFromHref('https://www.youtube.com/shorts/ZDB05cTiDUg?feature=share')).toBe('ZDB05cTiDUg');
    expect(videoIdFromHref('/@veritasium')).toBeNull();
  });
});
