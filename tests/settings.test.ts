import { describe, expect, it } from 'vitest';
import { autoFeedbackOn, checksOn, DEFAULT_SETTINGS, normalizeSettings, youtubeOn } from '../src/shared/settings';

describe('normalizeSettings', () => {
  it('fills defaults: local only — nothing talks to YouTube until the gate is turned on', () => {
    const s = normalizeSettings(undefined);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.youtubeRequests).toBe(false);
    expect(youtubeOn(s)).toBe(false);
    expect(checksOn(s)).toBe(false);
    expect(autoFeedbackOn(s)).toBe(false);
    expect(s.checkDailyLimit).toBe(150);
  });

  it('turning the gate on enables checks (sub-option on by default) but not automatic feedback', () => {
    const s = normalizeSettings({ youtubeRequests: true });
    expect(checksOn(s)).toBe(true);
    expect(autoFeedbackOn(s)).toBe(false);
    expect(checksOn({ ...s, enabled: false })).toBe(false); // Botless off wins over everything
  });

  it('upgrades settings saved before the gate existed without changing behaviour', () => {
    const hadChecks = normalizeSettings({ backgroundChecks: true, autoDontRecommend: false });
    expect(hadChecks.youtubeRequests).toBe(true);
    expect(checksOn(hadChecks)).toBe(true);

    const hadNothing = normalizeSettings({ backgroundChecks: false, autoDontRecommend: false });
    expect(hadNothing.youtubeRequests).toBe(false);
    expect(hadNothing.backgroundChecks).toBe(true); // so flipping the new gate later does what users expect

    const hadAutoOnly = normalizeSettings({ backgroundChecks: false, autoDontRecommend: true });
    expect(hadAutoOnly.youtubeRequests).toBe(true);
    expect(autoFeedbackOn(hadAutoOnly)).toBe(true);
  });

  it('clamps the daily check limit to 10–1000 and rounds it', () => {
    expect(normalizeSettings({ checkDailyLimit: 5 }).checkDailyLimit).toBe(10);
    expect(normalizeSettings({ checkDailyLimit: 99999 }).checkDailyLimit).toBe(1000);
    expect(normalizeSettings({ checkDailyLimit: 333.6 }).checkDailyLimit).toBe(334);
    expect(normalizeSettings({ checkDailyLimit: 'lots' }).checkDailyLimit).toBe(150);
  });
});
