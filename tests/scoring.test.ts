import { describe, expect, it } from 'vitest';
import { computeVerdict, VERDICT_LABEL } from '../src/shared/scoring';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const t = DEFAULT_SETTINGS.thresholds;
const v = (videosSeen: number, videosLabeled: number, extra = {}) => computeVerdict({ videosSeen, videosLabeled, ...extra }, t);

describe('computeVerdict', () => {
  it('gives no verdict without evidence', () => {
    expect(v(0, 0).verdict).toBeNull();
    expect(v(3, 0).verdict).toBeNull(); // too few unlabeled videos to say anything
  });

  it('override always wins', () => {
    expect(v(10, 10, { override: 'human' }).verdict).toBe('human');
    expect(v(10, 0, { override: 'ai' }).verdict).toBe('ai');
    expect(v(0, 0, { override: 'ai' }).reasons[0]!.signal).toBe('override');
  });

  it('flags a channel whose labeled share meets the ratio', () => {
    const r = v(10, 9);
    expect(r.verdict).toBe('ai');
    expect(r.reasons.map((x) => x.signal)).toEqual(['ratio']);
    expect(v(2, 2).verdict).toBe('ai');
  });

  it('stays inconclusive below the ratio or sample size', () => {
    expect(v(10, 8).verdict).toBe('inconclusive'); // 80% < 90%
    expect(v(1, 1).verdict).toBe('inconclusive'); // needs 2 videos
    expect(v(1, 1).reasons[0]!.text).toMatch(/need 2\+ videos/);
  });

  it('respects a custom ratio threshold', () => {
    expect(computeVerdict({ videosSeen: 10, videosLabeled: 8 }, { ...t, aiRatio: 0.75 }).verdict).toBe('ai');
  });

  it('treats many unlabeled videos as weak human evidence', () => {
    expect(v(5, 0).verdict).toBe('human');
    expect(v(4, 0).verdict).toBeNull();
  });

  it('ignores votes under the minimum and uses them above it', () => {
    const few = v(0, 0, { votes: { ai: 4, human: 0 } });
    expect(few.verdict).toBeNull();
    expect(few.reasons[0]!.weight).toBe(0);
    expect(v(0, 0, { votes: { ai: 10, human: 0 } }).verdict).toBe('ai');
    expect(v(0, 0, { votes: { ai: 5, human: 5 } }).verdict).toBeNull(); // weight 0 -> no active signal
    expect(v(0, 0, { votes: { ai: 6, human: 4 } }).verdict).toBe('inconclusive');
  });

  it('lets strong votes pull a partial disclosure over the line', () => {
    expect(v(10, 5).verdict).toBe('inconclusive');
    expect(v(10, 5, { votes: { ai: 20, human: 0 } }).verdict).toBe('ai');
  });

  it('clamps the score and sanitises input', () => {
    expect(v(10, 10, { votes: { ai: 100, human: 0 } }).score).toBe(1);
    expect(v(2, 5).reasons[0]!.text).toMatch(/2 of 2/); // labeled can't exceed seen
  });

  it('never claims certainty', () => {
    for (const label of Object.values(VERDICT_LABEL)) expect(label).toMatch(/^Probably|^Inconclusive$/);
  });
});
