import { describe, expect, it } from 'vitest';
import { lint } from '../scripts/check-commits.mjs';

describe('conventional commit lint', () => {
  it.each([
    'feat: add a thing',
    'fix(popup): keep the switch state after reload',
    'feat(scoring)!: need three labeled videos\n\nBREAKING CHANGE: stored verdicts are recomputed',
    'build(deps-dev): bump vitest from 3.2.7 to 3.3.0',
    'chore(release): 0.2.0',
    'docs: explain why\n\nBecause the diff shows what.\n\nCo-Authored-By: Someone <a@b.c>',
    'refactor: `serial()` queue now returns the result',
  ])('accepts %j', (msg) => {
    expect(lint(msg)).toEqual([]);
  });

  it.each([
    ['Remove the feature', /header must look like/],
    ['feature: add a thing', /unknown type "feature"/],
    ['fix(ui): button', /unknown scope "ui"/],
    ['fix: Add the thing', /start lowercase/],
    ['fix: add the thing.', /period/],
    ['fix:add the thing', /header must look like/],
    [`feat: ${'x'.repeat(70)}`, /max 72/],
    ['fix: header\nbody right after', /blank line/],
    ['feat!: drop it\n\nBREAKING CHANGES everything', /malformed footer/],
    ['fixup! feat: add a thing', /header must look like/],
  ])('rejects %j', (msg, problem) => {
    expect(lint(msg).join('\n')).toMatch(problem);
  });

  it('lets fixup! commits through locally (they are squashed before they land)', () => {
    expect(lint('fixup! feat: add a thing', { allowFixup: true })).toEqual([]);
  });
});
