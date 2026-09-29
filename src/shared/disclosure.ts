/**
 * Detect YouTube's OFFICIAL AI disclosure for a video. Pure — works on InnerTube JSON or a DOM subtree.
 *
 * What we found on youtube.com (desktop, verified 2026-09-28 — see docs/YOUTUBE-DOM.md):
 *
 *   ytInitialData / navigation response
 *     .engagementPanels[i].engagementPanelSectionListRenderer.content
 *       .structuredDescriptionContentRenderer.items[j].howThisWasMadeSectionViewModel
 *         { sectionTitle: {content: "How this was made"},
 *           bodyHeader:   {content: "Made with AI"},
 *           bodyText:     {content: "Sounds or visuals were altered or fully generated. Learn more",
 *                          commandRuns: [{ onTap: { innertubeCommand: { urlEndpoint: {
 *                            url: "//support.google.com/youtube/answer/15447836?hl=en" }}}}]} }
 *
 *   Rendered DOM: <how-this-was-made-section-view-model> with
 *     .ytwHowThisWasMadeSectionViewModelBodyHeader  -> "Made with AI"
 *     .ytwHowThisWasMadeSectionViewModelBodyText a  -> support.google.com/youtube/answer/15447836
 *
 * PITFALL: the same "How this was made" section is reused for YouTube's automatic dubbing
 * ("Auto-dubbed", answer/15569972). That is NOT a creator AI disclosure and must not count.
 *
 * Classification order: help-article ID (language independent) first, then English text as a fallback
 * (older label wording was "Altered or synthetic content").
 */
import type { Disclosure } from './types';

export const AI_ANSWER_IDS = new Set(['15447836', '14328491']);
export const AUTODUB_ANSWER_IDS = new Set(['15569972']);

const AI_TEXT = [/made with ai/i, /altered or synthetic/i, /altered or fully generated/i, /digitally (?:altered|generated)/i];
const AUTODUB_TEXT = [/auto-?dubbed/i, /audio tracks .* automatically generated/i];

/**
 * The article ID of a YouTube help link (`//support.google.com/youtube/answer/<id>?hl=…`), or null. The host is
 * checked exactly: a substring match would also accept `evil.example/support.google.com/youtube/answer/…`.
 */
export function helpArticleId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url, 'https://www.youtube.com/'); // YouTube's data uses protocol-relative links
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'support.google.com') return null;
  return /^\/youtube\/answer\/(\d+)$/.exec(u.pathname)?.[1] ?? null;
}

export interface SectionFacts {
  header: string;
  body: string;
  urls: string[];
}

export function classifySection(s: SectionFacts): Disclosure {
  const ids = s.urls.map(helpArticleId).filter((id): id is string => id !== null);
  if (ids.some((id) => AI_ANSWER_IDS.has(id))) return 'ai';
  if (ids.some((id) => AUTODUB_ANSWER_IDS.has(id))) return 'auto-dubbed';
  const text = `${s.header}\n${s.body}`;
  if (AUTODUB_TEXT.some((re) => re.test(text))) return 'auto-dubbed';
  if (AI_TEXT.some((re) => re.test(text))) return 'ai';
  return 'none';
}

/** Merge several section results: any AI section wins; auto-dub is reported but is not AI. */
function combine(results: Disclosure[]): Disclosure {
  if (results.includes('ai')) return 'ai';
  if (results.includes('auto-dubbed')) return 'auto-dubbed';
  return 'none';
}

function collectStrings(node: unknown, out: string[], depth = 0): void {
  if (depth > 12 || node == null) return;
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'object') for (const v of Object.values(node as object)) collectStrings(v, out, depth + 1);
}

/**
 * Walk an InnerTube response looking for disclosure sections.
 * `found` is false if no structured description was present at all — i.e. the data shape
 * may have changed and the caller should fall back to the DOM.
 */
export function detectDisclosureInData(root: unknown): { disclosure: Disclosure; found: boolean } {
  const results: Disclosure[] = [];
  let sawDescription = false;
  let budget = 400_000; // node cap: responses are ~1 MB of JSON; never spin on something pathological.
  const stack: unknown[] = [root];
  while (stack.length && budget-- > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const v of node) if (v && typeof v === 'object') stack.push(v);
      continue;
    }
    for (const [key, v] of Object.entries(node)) {
      if (key === 'structuredDescriptionContentRenderer') sawDescription = true;
      if (key === 'howThisWasMadeSectionViewModel' && v && typeof v === 'object') {
        const sec = v as { bodyHeader?: { content?: string }; bodyText?: { content?: string } };
        const urls: string[] = [];
        collectStrings(v, urls);
        results.push(
          classifySection({
            header: sec.bodyHeader?.content ?? '',
            body: sec.bodyText?.content ?? '',
            urls: urls.filter((u) => helpArticleId(u) !== null),
          }),
        );
      } else if (v && typeof v === 'object') {
        stack.push(v);
      }
    }
  }
  return { disclosure: combine(results), found: sawDescription || results.length > 0 };
}

/** DOM fallback. Only pass a subtree that belongs to the current video (e.g. ytd-watch-metadata). */
export function detectDisclosureInDom(root: ParentNode): Disclosure {
  const sections = root.querySelectorAll('how-this-was-made-section-view-model');
  const results: Disclosure[] = [];
  sections.forEach((el) => {
    const q = (cls: string) => el.querySelector(`[class*="${cls}"]`)?.textContent ?? '';
    results.push(
      classifySection({
        header: q('HowThisWasMadeSectionViewModelBodyHeader'),
        body: q('HowThisWasMadeSectionViewModelBodyText'),
        urls: [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
      }),
    );
  });
  return combine(results);
}
