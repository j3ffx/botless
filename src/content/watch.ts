import type { Settings } from '../shared/settings';
import type { PageInfo, VerdictResult } from '../shared/types';
import { makeBadge } from './badges';

// ---- Inline pill next to the channel name ----

const OWNER_TARGET: Record<'watch' | 'shorts', string> = {
  watch: 'ytd-watch-metadata ytd-video-owner-renderer #channel-name',
  shorts: 'ytd-shorts yt-reel-channel-bar-view-model',
};

export function renderOwnerBadge(page: PageInfo, result: VerdictResult | null, show: boolean): void {
  document.querySelectorAll('.botless-owner').forEach((b) => b.remove());
  if (!show || !result?.verdict || (page.pageType !== 'watch' && page.pageType !== 'shorts')) return;
  const sel = OWNER_TARGET[page.pageType];
  // Shorts keep several reels in the DOM; the visible one is the one nearest the viewport centre.
  const targets = [...document.querySelectorAll<HTMLElement>(sel)];
  const target =
    page.pageType === 'shorts'
      ? targets.find((t) => {
          const r = t.getBoundingClientRect();
          return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
        })
      : targets[0];
  target?.append(makeBadge(result, 'botless-owner'));
}

// ---- Auto-skip with Undo ----

/** Videos the user rescued with Undo in this tab; never auto-skip them again. */
const allowed = new Set<string>();
let active: { videoId: string; timer: ReturnType<typeof setTimeout>; toast: HTMLElement; paused: HTMLVideoElement | null } | null =
  null;

function mainVideo(page: PageInfo): HTMLVideoElement | null {
  return document.querySelector(page.pageType === 'shorts' ? '#shorts-player video' : '#movie_player video');
}

export function cancelSkip(resume = false): void {
  if (!active) return;
  clearTimeout(active.timer);
  active.toast.remove();
  if (resume) void active.paused?.play().catch(() => undefined);
  active = null;
}

function doSkip(page: PageInfo, settings: Settings): void {
  if (page.pageType === 'shorts') {
    const next = document.querySelector<HTMLElement>('#navigation-button-down button, button[aria-label="Next video"]');
    if (next) return next.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
    return;
  }
  if (settings.skipTarget === 'next') {
    const next = document.querySelector<HTMLAnchorElement>('#movie_player .ytp-next-button');
    const usable = next && next.getAttribute('aria-disabled') !== 'true' && getComputedStyle(next).display !== 'none';
    if (usable) return next.click();
  }
  if (history.length > 1) history.back();
  else location.assign('/');
}

export function maybeSkip(page: PageInfo, result: VerdictResult, settings: Settings): void {
  const vid = page.videoId;
  if (!vid || !settings.enabled || !settings.autoSkip || result.verdict !== 'ai' || allowed.has(vid)) return;
  if (active?.videoId === vid) return;
  cancelSkip();

  const video = mainVideo(page);
  const wasPlaying = !!video && !video.paused;
  if (wasPlaying) video.pause();

  const toast = document.createElement('div');
  toast.className = 'botless-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.style.setProperty('--botless-delay', `${settings.skipDelaySeconds}s`);
  const msg = document.createElement('span');
  msg.className = 'botless-toast-msg';
  const strong = document.createElement('b');
  strong.textContent = 'Skipping likely-AI video';
  msg.append(strong);
  msg.title = result.reasons.map((r) => r.text).join('\n');
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.textContent = 'Undo';
  undo.addEventListener('click', () => {
    allowed.add(vid);
    cancelSkip(true);
  });
  const bar = document.createElement('span');
  bar.className = 'botless-toast-bar';
  toast.append(msg, undo, bar);
  document.body.append(toast);

  const timer = setTimeout(() => {
    const still = active?.videoId === vid && location.href.includes(vid);
    cancelSkip();
    if (still) doSkip(page, settings);
  }, settings.skipDelaySeconds * 1000);
  active = { videoId: vid, timer, toast, paused: wasPlaying ? video : null };
}
