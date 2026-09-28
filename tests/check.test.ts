import { describe, expect, it } from 'vitest';
import { checkNeed, nextRequestBody, parseChannelFeed, parseNextResponse, pickConfirmVideo } from '../src/shared/check';
import type { ChannelRecord } from '../src/shared/types';
import { AUTO_DUBBED_SECTION, MADE_WITH_AI_SECTION, watchResponse } from './fixtures';

const CID = 'UCZy_1WNgqZXMqrYeKoX-n1A';
const rec = (videos: Record<string, 0 | 1>): ChannelRecord => ({ id: CID, videos, firstSeen: 0, lastSeen: 0 });

/** Shape of a real /youtubei/v1/next response (trimmed): owner in videoSecondaryInfoRenderer + description panels. */
const nextResponse = (...sections: object[]) => ({
  ...watchResponse(...sections),
  contents: {
    twoColumnWatchNextResults: {
      results: {
        results: {
          contents: [
            { videoPrimaryInfoRenderer: { title: { runs: [{ text: 'Top 3 Most Popular AI Generated Songs' }] } } },
            {
              videoSecondaryInfoRenderer: {
                owner: {
                  videoOwnerRenderer: {
                    title: { runs: [{ text: 'We R Cinephiles' }] },
                    navigationEndpoint: { browseEndpoint: { browseId: CID, canonicalBaseUrl: '/@WeRCinephiles' } },
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

describe('checkNeed', () => {
  it('checks unknown channels, confirms a single labeled video, and otherwise stops', () => {
    expect(checkNeed(undefined, undefined)).toBe('video');
    expect(checkNeed(rec({}), undefined)).toBe('video');
    expect(checkNeed(rec({ aaaaaaaaaaa: 1 }), undefined)).toBe('confirm');
    expect(checkNeed(rec({ aaaaaaaaaaa: 0 }), undefined)).toBeNull();
    expect(checkNeed(rec({ aaaaaaaaaaa: 1, bbbbbbbbbbb: 1 }), undefined)).toBeNull();
  });

  it('never checks channels the user marked', () => {
    expect(checkNeed(undefined, { verdict: 'human', at: 0 })).toBeNull();
  });
});

describe('parseNextResponse', () => {
  it('reads the owner and the official label', () => {
    expect(parseNextResponse(nextResponse(MADE_WITH_AI_SECTION))).toEqual({ channelId: CID, channelName: 'We R Cinephiles', disclosure: 'ai' });
  });

  it('reports auto-dubbed and unlabeled videos distinctly', () => {
    expect(parseNextResponse(nextResponse(AUTO_DUBBED_SECTION)).disclosure).toBe('auto-dubbed');
    expect(parseNextResponse(nextResponse()).disclosure).toBe('none');
  });

  it('returns disclosure null when the response has no description (format changed)', () => {
    expect(parseNextResponse({ contents: {} })).toEqual({ channelId: null, channelName: undefined, disclosure: null });
    expect(parseNextResponse(null).disclosure).toBeNull();
  });
});

describe('channel feed', () => {
  const xml = `<feed><entry><yt:videoId>TCp_fT90F5s</yt:videoId></entry><entry><yt:videoId>ZneqyXsgpO4</yt:videoId></entry>
    <entry><yt:videoId>D1hIn4SA-q4</yt:videoId></entry></feed>`;

  it('lists video IDs newest first', () => {
    expect(parseChannelFeed(xml)).toEqual(['TCp_fT90F5s', 'ZneqyXsgpO4', 'D1hIn4SA-q4']);
    expect(parseChannelFeed('<html>error</html>')).toEqual([]);
  });

  it('picks the newest video not already checked', () => {
    expect(pickConfirmVideo(parseChannelFeed(xml), rec({ TCp_fT90F5s: 1 }))).toBe('ZneqyXsgpO4');
    expect(pickConfirmVideo(['TCp_fT90F5s'], rec({ TCp_fT90F5s: 1 }))).toBeNull();
  });
});

describe('nextRequestBody', () => {
  it('asks for the plain web client without any account data', () => {
    expect(JSON.parse(nextRequestBody('ZneqyXsgpO4', '2.20260925.01.00'))).toEqual({
      context: { client: { clientName: 'WEB', clientVersion: '2.20260925.01.00', hl: 'en', gl: 'US' } },
      videoId: 'ZneqyXsgpO4',
    });
  });
});
