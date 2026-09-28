import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings';

describe('normalizeSettings', () => {
  it('fills defaults, with background checks off', () => {
    const s = normalizeSettings(undefined);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.backgroundChecks).toBe(false);
    expect(s.checkDailyLimit).toBe(150);
  });

  it('clamps the daily check limit to 10–1000 and rounds it', () => {
    expect(normalizeSettings({ checkDailyLimit: 5 }).checkDailyLimit).toBe(10);
    expect(normalizeSettings({ checkDailyLimit: 99999 }).checkDailyLimit).toBe(1000);
    expect(normalizeSettings({ checkDailyLimit: 333.6 }).checkDailyLimit).toBe(334);
    expect(normalizeSettings({ checkDailyLimit: 'lots' }).checkDailyLimit).toBe(150);
  });
});
