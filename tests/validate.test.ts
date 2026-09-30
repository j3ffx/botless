import { describe, expect, it } from 'vitest';
import { MAX_IDS, MAX_NAME, parsePageInfo, parseSwRequest } from '../src/shared/validate';

const CID = 'UCZy_1WNgqZXMqrYeKoX-n1A';
const VID = 'ZneqyXsgpO4';
const WATCH = `https://www.youtube.com/watch?v=${VID}`;

describe('parsePageInfo (events any page script could forge)', () => {
  it('keeps well-formed info about the page actually shown', () => {
    const info = { pageType: 'watch', url: WATCH, videoId: VID, channelId: CID, channelName: 'We R Cinephiles', disclosure: 'ai', disclosureSource: 'data' };
    expect(parsePageInfo(info, WATCH)).toEqual(info);
    expect(parsePageInfo({ pageType: 'channel', url: 'https://www.youtube.com/@x', channelId: CID }, 'https://www.youtube.com/@x')).toEqual({
      pageType: 'channel',
      url: 'https://www.youtube.com/@x',
      channelId: CID,
    });
  });

  it('rejects info about another video than the one in the address bar', () => {
    // A forged event trying to record a label for some other video while this one plays.
    expect(parsePageInfo({ pageType: 'watch', url: WATCH, videoId: 'aaaaaaaaaaa', channelId: CID, disclosure: 'ai' }, WATCH)).toBeNull();
  });

  it('rejects info about another page', () => {
    expect(parsePageInfo({ pageType: 'watch', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', videoId: 'aaaaaaaaaaa' }, WATCH)).toBeNull();
  });

  it('rejects malformed IDs and unknown page types', () => {
    expect(parsePageInfo({ pageType: 'watch', url: WATCH, videoId: VID, channelId: 'UC-not-an-id' }, WATCH)).toBeNull();
    expect(parsePageInfo({ pageType: 'admin', url: WATCH }, WATCH)).toBeNull();
    expect(parsePageInfo('string', WATCH)).toBeNull();
    expect(parsePageInfo(null, WATCH)).toBeNull();
  });

  it('drops unknown disclosure values and caps the channel name', () => {
    const info = parsePageInfo({ pageType: 'watch', url: WATCH, videoId: VID, disclosure: 'definitely-ai', channelName: 'x'.repeat(5_000_000) }, WATCH);
    expect(info?.disclosure).toBeUndefined();
    expect(info?.channelName).toHaveLength(MAX_NAME);
  });
});

describe('parseSwRequest (defence in depth in the service worker)', () => {
  it('rebuilds valid requests from known fields only', () => {
    expect(parseSwRequest({ type: 'observe', channelId: CID, videoId: VID, labeled: true, name: 'n', extra: 'x' })).toEqual({
      type: 'observe',
      channelId: CID,
      videoId: VID,
      labeled: true,
      name: 'n',
    });
    expect(parseSwRequest({ type: 'checkPermit' })).toEqual({ type: 'checkPermit' });
    expect(parseSwRequest({ type: 'setOverride', channelId: CID, verdict: null })).toEqual({ type: 'setOverride', channelId: CID, verdict: null, name: undefined });
  });

  it('rejects unknown types and malformed fields', () => {
    expect(parseSwRequest({ type: 'deleteEverything' })).toBeNull();
    expect(parseSwRequest({ type: 'observe', channelId: CID, videoId: VID, labeled: 'yes' })).toBeNull();
    expect(parseSwRequest({ type: 'observe', channelId: 'UC' + 'x'.repeat(1000), videoId: VID, labeled: true })).toBeNull();
    expect(parseSwRequest({ type: 'setOverride', channelId: CID, verdict: 'maybe' })).toBeNull();
    expect(parseSwRequest({ type: 'checkFailed', status: 'oops' })).toBeNull();
    expect(parseSwRequest(undefined)).toBeNull();
  });

  it('filters and caps ID lists', () => {
    const many = Array.from({ length: MAX_IDS * 3 }, (_, i) => `v${String(i).padStart(10, '0')}`);
    const r = parseSwRequest({ type: 'flagged', videoIds: [...many, 'bad', 42] });
    expect(r?.type === 'flagged' && r.videoIds.length).toBe(MAX_IDS);
    const pairs = parseSwRequest({ type: 'learnVideos', pairs: [[VID, CID], [VID, 'nope'], 'junk', [VID]] });
    expect(pairs).toEqual({ type: 'learnVideos', pairs: [[VID, CID]] });
  });
});
