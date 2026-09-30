import { describe, expect, it } from 'vitest';
import { entryBytes, keysToEvict, STORAGE_HIGH, STORAGE_LOW } from '../src/shared/retention';

const QUOTA = 10_000;
const rec = (key: string, lastSeen: number, bytes = 1000) => ({ key, lastSeen, bytes });

describe('keysToEvict', () => {
  it('does nothing below the high-water mark', () => {
    expect(keysToEvict([rec('c:a', 1)], QUOTA * STORAGE_HIGH - 1, QUOTA)).toEqual([]);
  });

  it('drops the least recently seen channels until usage is under the low-water mark', () => {
    const records = [rec('c:new', 300), rec('c:old', 100), rec('c:mid', 200)];
    // 8000 used, target 5000: frees 3000 = the three records, oldest first.
    expect(keysToEvict(records, 8000, QUOTA)).toEqual(['c:old', 'c:mid', 'c:new']);
    // 7000 used, target 5000: two records are enough.
    expect(keysToEvict(records, 7000, QUOTA)).toEqual(['c:old', 'c:mid']);
  });

  it('stops when there is nothing left to drop', () => {
    expect(keysToEvict([], 9999, QUOTA)).toEqual([]);
  });

  it('estimates entry size from the key and JSON value', () => {
    expect(entryBytes('c:x', { a: 1 })).toBe('c:x'.length + '{"a":1}'.length);
    expect(STORAGE_LOW).toBeLessThan(STORAGE_HIGH);
  });
});
