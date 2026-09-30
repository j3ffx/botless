// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { classifySection, detectDisclosureInData, detectDisclosureInDom, helpArticleId } from '../src/shared/disclosure';
import { AUTO_DUBBED_SECTION, MADE_WITH_AI_SECTION, watchResponse } from './fixtures';

describe('detectDisclosureInData', () => {
  it('detects the official "Made with AI" section', () => {
    expect(detectDisclosureInData(watchResponse(MADE_WITH_AI_SECTION))).toEqual({ disclosure: 'ai', found: true });
  });

  it('does not treat YouTube auto-dubbing as an AI disclosure', () => {
    expect(detectDisclosureInData(watchResponse(AUTO_DUBBED_SECTION)).disclosure).toBe('auto-dubbed');
  });

  it('prefers AI when both sections are present', () => {
    expect(detectDisclosureInData(watchResponse(AUTO_DUBBED_SECTION, MADE_WITH_AI_SECTION)).disclosure).toBe('ai');
  });

  it('ignores "made with AI" written by the creator in title/description', () => {
    expect(detectDisclosureInData(watchResponse())).toEqual({ disclosure: 'none', found: true });
  });

  it('reports found=false when the data has no description at all (shape changed)', () => {
    expect(detectDisclosureInData({ contents: {} }).found).toBe(false);
    expect(detectDisclosureInData(undefined).found).toBe(false);
  });
});

describe('helpArticleId', () => {
  it('reads every link form YouTube uses', () => {
    expect(helpArticleId('//support.google.com/youtube/answer/15447836?hl=en')).toBe('15447836'); // watch data
    expect(helpArticleId('https://support.google.com/youtube/answer/15569972')).toBe('15569972'); // rendered DOM
    expect(helpArticleId('https://support.google.com/youtube/answer/15447836?hl=de#x')).toBe('15447836');
  });

  it('rejects other hosts, other paths and non-URLs', () => {
    expect(helpArticleId('https://support.google.com/chrome/answer/15447836')).toBeNull();
    expect(helpArticleId('https://support.google.com/youtube/answer/15447836/extra')).toBeNull();
    expect(helpArticleId('Learn more')).toBeNull();
    expect(helpArticleId('')).toBeNull();
  });
});

describe('classifySection', () => {
  it('uses the help-article ID regardless of language', () => {
    expect(
      classifySection({ header: 'Mit KI erstellt', body: 'Weitere Infos', urls: ['//support.google.com/youtube/answer/15447836?hl=de'] }),
    ).toBe('ai');
    expect(
      classifySection({ header: 'Automatisch synchronisiert', body: '', urls: ['https://support.google.com/youtube/answer/15569972'] }),
    ).toBe('auto-dubbed');
  });

  it('only trusts links whose host is exactly support.google.com', () => {
    const spoofed = [
      'https://evil.example/support.google.com/youtube/answer/15447836',
      'https://support.google.com.evil.example/youtube/answer/15447836',
      'https://evil.example/?next=//support.google.com/youtube/answer/15447836',
      'http://support.google.com/youtube/answer/15447836',
      'support.google.com/youtube/answer/15447836',
    ];
    for (const url of spoofed) expect(classifySection({ header: 'Something else', body: '', urls: [url] }), url).toBe('none');
  });

  it('falls back to English text, including the older wording', () => {
    expect(classifySection({ header: 'Altered or synthetic content', body: '', urls: [] })).toBe('ai');
    expect(classifySection({ header: 'Something else', body: '', urls: [] })).toBe('none');
  });
});

describe('detectDisclosureInDom', () => {
  it('reads the rendered view model', () => {
    document.body.innerHTML = [
      '<ytd-watch-metadata>',
      '<how-this-was-made-section-view-model class="ytwHowThisWasMadeSectionViewModelHost">',
      '<div class="ytwHowThisWasMadeSectionViewModelSectionTitle">How this was made</div>',
      '<div class="ytwHowThisWasMadeSectionViewModelBodyHeader">Made with AI</div>',
      '<div class="ytwHowThisWasMadeSectionViewModelBodyText">Sounds or visuals were altered or fully generated. ',
      '<a href="https://support.google.com/youtube/answer/15447836?hl=en">Learn more</a></div>',
      '</how-this-was-made-section-view-model>',
      '</ytd-watch-metadata>',
    ].join('');
    expect(detectDisclosureInDom(document)).toBe('ai');

    // Nothing rendered means unknown, not "no label": the caller records nothing.
    document.body.innerHTML = '<ytd-watch-metadata></ytd-watch-metadata>';
    expect(detectDisclosureInDom(document)).toBeNull();
  });
});
