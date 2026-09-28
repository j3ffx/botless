import { VERDICT_LABEL } from '../shared/scoring';
import type { Action, VerdictResult } from '../shared/types';

/** Wrappers whose whole cell should fade/hide so grids reflow instead of leaving holes. */
const ITEM_ROOT = [
  'ytd-rich-item-renderer',
  'ytd-grid-video-renderer',
  'ytd-reel-item-renderer',
  '[class*="GridShelfViewModelGridShelfItem"]',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-playlist-panel-video-renderer',
].join(',');

/** Thumbnail containers, newest markup first. Verified 2026-09-28. */
const THUMB = [
  'yt-thumbnail-view-model',
  '.ytLockupViewModelContentImage',
  '[class*="shortsLockupViewModelHostThumbnailParentContainer"]',
  '[class*="shortsLockupViewModelHostThumbnailContainer"]',
  'ytd-thumbnail',
  'a#thumbnail',
].join(',');

export const itemRoot = (el: Element): HTMLElement => (el.closest(ITEM_ROOT) as HTMLElement | null) ?? (el as HTMLElement);

export function tooltip(result: VerdictResult): string {
  const lines = result.reasons.filter((r) => r.weight !== 0).map((r) => `• ${r.text}`);
  return `Botless: ${result.verdict ? VERDICT_LABEL[result.verdict] : ''}\n${lines.join('\n')}`.trim();
}

export function makeBadge(result: VerdictResult, cls = 'botless-badge'): HTMLElement {
  const b = document.createElement('span');
  b.className = `${cls} botless-${result.verdict}`;
  b.setAttribute('role', 'note');
  b.title = tooltip(result);
  const dot = document.createElement('span');
  dot.className = 'botless-dot';
  b.append(dot, result.verdict ? VERDICT_LABEL[result.verdict] : '');
  return b;
}

export function clearTile(el: HTMLElement): void {
  el.querySelectorAll(':scope .botless-badge').forEach((b) => b.remove());
  const root = itemRoot(el);
  root.classList.remove('botless-fade', 'botless-hide');
  delete el.dataset.botlessApplied;
}

/** Returns false if the tile has no thumbnail yet (lazy render) so the caller can retry. */
export function applyTile(el: HTMLElement, result: VerdictResult, action: Action): boolean {
  el.querySelectorAll(':scope .botless-badge').forEach((b) => b.remove());
  const root = itemRoot(el);
  root.classList.toggle('botless-fade', action === 'fade');
  root.classList.toggle('botless-hide', action === 'hide');
  if (action === 'badge' || action === 'fade') {
    const thumb = el.querySelector<HTMLElement>(THUMB);
    if (!thumb) return false;
    thumb.classList.add('botless-anchor');
    thumb.append(makeBadge(result));
  }
  return true;
}

export const hasBadge = (el: Element): boolean => !!el.querySelector(':scope .botless-badge');
