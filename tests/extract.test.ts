import { describe, expect, it } from 'vitest';
import {
  channelIdFromChannelPage,
  channelIdFromRendererData,
  findChannelBrowseId,
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
