/**
 * Isolated-world content script. Reads the IDs the MAIN-world bridge stamped onto tiles, looks up
 * verdicts in chrome.storage.local, and renders badges / fade / hide, the watch-page pill and auto-skip.
 * All writes go through the service worker so concurrent tabs can't clobber each other.
 */
import type { ChannelSummary, SwRequest, TabRequest, TabResponse } from '../shared/messages';
import { autoFeedbackOn, checksOn, normalizeSettings, youtubeOn, type Settings } from '../shared/settings';
import { getChannels, getDontRecs, getOverrides, getSettings, getVmap, isChannelKey, KEY } from '../shared/storage';
import type { ChannelRecord, DontRecs, Overrides, PageInfo, VerdictResult } from '../shared/types';
import { resolveVerdict, withVideoLabel } from '../shared/verdict';
import type { FeedbackKind } from '../shared/feedback';
import { checkNeed } from '../shared/check';
import { applyTile, canHostDontRec, clearTile, hasBadge, hasDontRecButton, setDontRecButton } from './badges';
import { createChecker } from './checker';
import { cancelSkip, maybeSkip, renderOwnerBadge } from './watch';

let settings: Settings = normalizeSettings(undefined);
let overrides: Overrides = {};
let vmap: Record<string, string> = {};
/** Channels already told "don't recommend" (by this or another tab). */
let dontrecs: DontRecs = {};
/** undefined = not loaded yet, null = loaded and unknown to us. */
const channels = new Map<string, ChannelRecord | null>();
/** Bumped whenever something that affects rendering changes; part of each tile's applied signature. */
let gen = 0;
let page: PageInfo | null = null;
let pageResult: VerdictResult | null = null;

// ---- Orphan detection ----
// When the extension is reloaded or updated, this copy keeps running in tabs that were already open, but
// every chrome.* call now throws "Extension context invalidated". Chrome doesn't re-inject into those tabs,
// so the only sane thing is to remove our UI and go quiet until the user refreshes the page.

let dead = false;
function alive(): boolean {
  if (dead) return false;
  try {
    if (chrome.runtime?.id) return true;
  } catch {
    /* context invalidated */
  }
  shutdown();
  return false;
}

function shutdown(): void {
  dead = true;
  clearTimeout(flushTimer);
  clearTimeout(loadTimer);
  cancelSkip();
  checker.stop();
  clearTimeout(autoTimer);
  autoQueue.clear();
  document.removeEventListener('botless:dont-recommend-result', onDontRecResult);
  clearTimeout(scrollTimer);
  removeEventListener('scroll', onScroll);
  document.removeEventListener('visibilitychange', onVisibility);
  document.removeEventListener('botless:page', onPageEvent);
  document.removeEventListener('botless:scan', schedulePass);
  document.removeEventListener('yt-navigate-start', onNavigateStart);
  document.querySelectorAll('.botless-badge, .botless-owner').forEach((el) => el.remove());
  document.querySelectorAll('.botless-fade, .botless-hide').forEach((el) => el.classList.remove('botless-fade', 'botless-hide'));
}

function send(msg: SwRequest): Promise<any> {
  if (!alive()) return Promise.resolve(undefined);
  try {
    return chrome.runtime.sendMessage(msg).catch(() => (alive(), undefined));
  } catch {
    shutdown();
    return Promise.resolve(undefined);
  }
}

// ---- Batched fire-and-forget messages ----

const pendingLoads = new Set<string>();
const pendingFlags = new Set<string>();
const pendingPairs = new Map<string, string>();
const pendingRefresh = new Set<string>();
const flaggedThisTab = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleFlush(): void {
  flushTimer ??= setTimeout(() => {
    flushTimer = undefined;
    if (pendingFlags.size) send({ type: 'flagged', videoIds: [...pendingFlags] });
    if (pendingPairs.size) send({ type: 'learnVideos', pairs: [...pendingPairs] });
    if (pendingRefresh.size) send({ type: 'refresh', channelIds: [...pendingRefresh] });
    pendingFlags.clear();
    pendingPairs.clear();
    pendingRefresh.clear();
  }, 2000);
}

let loadTimer: ReturnType<typeof setTimeout> | undefined;
function loadMissing(): void {
  loadTimer ??= setTimeout(async () => {
    loadTimer = undefined;
    const ids = [...pendingLoads];
    pendingLoads.clear();
    if (!alive()) return;
    let got: Awaited<ReturnType<typeof getChannels>>;
    try {
      got = await getChannels(ids);
    } catch {
      alive(); // shuts down if the extension went away; otherwise the next pass retries
      return;
    }
    for (const id of ids) channels.set(id, got[id] ?? null);
    schedulePass();
  }, 50);
}

function verdictFor(cid: string): VerdictResult | undefined {
  const rec = channels.get(cid);
  if (rec === undefined && !overrides[cid]) {
    pendingLoads.add(cid);
    loadMissing();
    return undefined;
  }
  const { result, stale } = resolveVerdict(rec ?? undefined, overrides[cid], settings, Date.now());
  if (stale) {
    pendingRefresh.add(cid);
    scheduleFlush();
  }
  return result;
}

function noteFlagged(vid: string | undefined): void {
  if (!vid || flaggedThisTab.has(vid)) return;
  flaggedThisTab.add(vid);
  pendingFlags.add(vid);
  scheduleFlush();
}

// ---- Tile pass (runs after each debounced bridge scan) ----

// ---- Opt-in background checks (src/content/checker.ts) ----

const checker = createChecker({
  send,
  record: (cid) => channels.get(cid) ?? undefined,
  override: (cid) => overrides[cid],
  active: () => alive() && checksOn(settings) && document.visibilityState === 'visible',
});

function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
}

// Scrolling through tiles that are already loaded changes nothing in the DOM, so no scan fires; while checks are
// on, re-run the pass a couple of times a second so newly visible tiles get offered.
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
function onScroll(): void {
  if (!checksOn(settings) || scrollTimer !== undefined) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = undefined;
    schedulePass();
  }, 500);
}
function onVisibility(): void {
  checker.resume();
  if (autoQueue.size) kickAuto(1000);
}
addEventListener('scroll', onScroll, { passive: true });
document.addEventListener('visibilitychange', onVisibility);

// ---- "Don't recommend channel" (performed by the bridge through YouTube's own menu) ----

type DontRecResult = 'ok' | 'unavailable' | 'busy' | 'menu';
const dontRecWaiters = new Map<string, (r: DontRecResult) => void>();

function onDontRecResult(e: Event): void {
  try {
    const { videoId, result } = JSON.parse(String((e as CustomEvent).detail)) as { videoId: string; result: DontRecResult };
    dontRecWaiters.get(videoId)?.(result);
    dontRecWaiters.delete(videoId);
  } catch {
    /* ignore malformed */
  }
}
document.addEventListener('botless:dont-recommend-result', onDontRecResult);

/**
 * kind 'channel' = "Don't recommend channel" (remembered per channel, never repeated);
 * kind 'video'   = "Not interested" (Shorts tiles only offer this; per video, YouTube drops the Short).
 */
function dontRecommend(videoId: string, channelId: string, auto: boolean, kind: FeedbackKind): Promise<DontRecResult> {
  return new Promise<DontRecResult>((resolve) => {
    dontRecWaiters.set(videoId, resolve);
    document.dispatchEvent(new CustomEvent('botless:dont-recommend', { detail: JSON.stringify({ videoId }) }));
    setTimeout(() => dontRecWaiters.delete(videoId) && resolve('menu'), 5000);
  }).then((r) => {
    if (r === 'ok' && kind === 'channel') {
      void send({ type: 'dontRecommended', channelId, name: channels.get(channelId)?.name ?? undefined, auto });
    }
    return r;
  });
}

async function onDontRecClick(button: HTMLButtonElement, videoId: string, channelId: string, kind: FeedbackKind): Promise<void> {
  button.disabled = true;
  button.textContent = 'Telling YouTube…';
  const r = await dontRecommend(videoId, channelId, false, kind);
  if (r === 'ok') return; // YouTube replaces the tile with its own "Undo" notice
  button.disabled = false;
  button.textContent = r === 'busy' ? 'Close the open menu, then retry' : "Couldn't do it — retry";
}

// Auto mode (opt-in): one at a time, a few seconds apart, never twice for the same channel (or Short).
type AutoJob = { videoId: string; channelId: string; kind: FeedbackKind };
const autoQueue = new Map<string, AutoJob>(); // "c:<channel>" or "v:<video>" -> job
const autoTried = new Set<string>();
let autoTimer: ReturnType<typeof setTimeout> | undefined;

function offerAuto(videoId: string, channelId: string, kind: FeedbackKind): void {
  const key = kind === 'channel' ? `c:${channelId}` : `v:${videoId}`;
  if (autoTried.has(key) || autoQueue.has(key)) return;
  autoQueue.set(key, { videoId, channelId, kind });
  kickAuto(1000);
}

function kickAuto(delayMs: number): void {
  if (autoTimer !== undefined) return;
  autoTimer = setTimeout(async () => {
    autoTimer = undefined;
    if (!alive() || !autoFeedbackOn(settings) || document.visibilityState !== 'visible') return;
    const next = autoQueue.entries().next();
    if (next.done) return;
    const [key, job] = next.value;
    autoQueue.delete(key);
    if (job.kind === 'video' || !dontrecs[job.channelId]) {
      const r = await dontRecommend(job.videoId, job.channelId, true, job.kind);
      if (r === 'busy') {
        autoQueue.set(key, job); // user is typing / has a menu open: try again later
        return kickAuto(5000);
      }
      autoTried.add(key);
    }
    if (autoQueue.size) kickAuto(3000);
  }, delayMs);
}

function pass(): void {
  if (!alive()) return;
  const tiles = document.querySelectorAll<HTMLElement>('[data-botless-key], [data-botless-applied]');
  for (const el of tiles) {
    const vid = el.dataset.botlessVid;
    let cid = el.dataset.botlessCid;
    if (vid && cid && vmap[vid] !== cid) pendingPairs.set(vid, cid);
    cid ??= vid ? vmap[vid] : undefined;
    if (!settings.enabled || !cid || !el.dataset.botlessKey) {
      // Channel-less tile (a Short): checking its video reveals both its channel and its AI label.
      if (checksOn(settings) && vid && !cid && el.dataset.botlessKey && onScreen(el)) checker.offer(vid, null);
      if (el.dataset.botlessApplied) clearTile(el);
      continue;
    }
    const channelResult = verdictFor(cid);
    if (!channelResult) continue; // loading; the load callback schedules another pass
    if (checksOn(settings) && vid && checkNeed(channels.get(cid) ?? undefined, overrides[cid]) && onScreen(el)) {
      checker.offer(vid, cid);
    }
    // A video carrying YouTube's own AI label is AI content even if its channel isn't judged yet.
    const result = withVideoLabel(channelResult, !!vid && channels.get(cid)?.videos[vid] === 1, overrides[cid]);
    const action = result.verdict ? settings.actions[result.verdict] : 'none';
    const needsBadge = action === 'badge' || action === 'fade';
    // YouTube's own feedback: "Don't recommend channel" on video tiles, "Not interested" on Shorts (signed in, feeds).
    const kind = el.dataset.botlessDontrec as FeedbackKind | undefined;
    // Needs the "Connect to YouTube" gate: without it Botless never acts on the user's YouTube account.
    const canDontRec = youtubeOn(settings) && result.verdict === 'ai' && !!vid && !!kind && (kind === 'video' || !dontrecs[cid]);
    const wantButton = canDontRec && needsBadge && canHostDontRec(el);
    // Hidden tiles are display:none (never "on screen"), but that is exactly when auto mode is most wanted.
    if (canDontRec && autoFeedbackOn(settings) && (action === 'hide' || onScreen(el))) offerAuto(vid!, cid, kind!);
    const sig = `${el.dataset.botlessKey}|${result.verdict}|${action}|${wantButton}|${gen}`;
    if (el.dataset.botlessApplied === sig && (!needsBadge || hasBadge(el)) && (!wantButton || hasDontRecButton(el))) continue;
    if (action === 'none') clearTile(el);
    else if (!applyTile(el, result, action)) continue; // thumbnail not rendered yet; retry next pass
    const tileCid = cid;
    setDontRecButton(el, wantButton, kind ?? 'channel', (button) => void onDontRecClick(button, vid!, tileCid, kind!));
    el.dataset.botlessApplied = sig;
    if (result.verdict === 'ai') noteFlagged(vid);
  }
  if (pendingPairs.size) scheduleFlush();
  // The owner area renders lazily and YouTube re-renders it on navigation; restore the pill if it's gone.
  if (page && pageResult && pillVisible(pageResult) && !document.querySelector('.botless-owner')) {
    renderOwnerBadge(page, pageResult, true);
  }
}

let passQueued = false;
function schedulePass(): void {
  if (passQueued) return;
  passQueued = true;
  requestAnimationFrame(() => {
    passQueued = false;
    pass();
  });
}

// ---- Current page (watch / shorts / channel) ----

/** The pill follows the verdict's action, except "Probably AI" always shows on the video you're watching. */
const pillVisible = (r: VerdictResult): boolean =>
  settings.enabled && !!r.verdict && (r.verdict === 'ai' || settings.actions[r.verdict] !== 'none');

async function onPage(info: PageInfo): Promise<void> {
  const changedVideo = info.videoId !== page?.videoId || info.pageType !== page?.pageType;
  if (changedVideo) cancelSkip();
  page = info;
  pageResult = null;
  renderOwnerBadge(info, null, false);
  if (!settings.enabled || !info.channelId) return;

  let summary: ChannelSummary | undefined;
  if (info.videoId && info.disclosure) {
    summary = await send({
      type: 'observe',
      channelId: info.channelId,
      name: info.channelName,
      videoId: info.videoId,
      labeled: info.disclosure === 'ai',
    });
  } else {
    summary = await send({ type: 'getChannel', channelId: info.channelId });
  }
  if (!summary || page !== info) return; // navigated away meanwhile
  channels.set(info.channelId, summary.record ?? null);
  // The video playing right now carries YouTube's AI label: AI for this video (auto-skips labeled Shorts too).
  pageResult = withVideoLabel(summary.result, info.disclosure === 'ai', summary.override);
  gen++;
  schedulePass();

  renderOwnerBadge(info, pageResult, pillVisible(pageResult));
  if (pageResult.verdict === 'ai') {
    noteFlagged(info.videoId);
    maybeSkip(info, pageResult, settings);
  }
}

function onPageEvent(e: Event): void {
  const detail = (e as CustomEvent<string>).detail;
  if (typeof detail !== 'string' || !alive()) return;
  try {
    void onPage(JSON.parse(detail) as PageInfo);
  } catch {
    /* ignore malformed */
  }
}
function onNavigateStart(): void {
  cancelSkip();
}
document.addEventListener('botless:page', onPageEvent);
document.addEventListener('botless:scan', schedulePass);
document.addEventListener('yt-navigate-start', onNavigateStart);

// ---- Popup queries ----

chrome.runtime.onMessage.addListener((msg: TabRequest, _sender, reply: (r: TabResponse) => void) => {
  if (msg?.type === 'getPageInfo') reply({ page: page && page.url === location.href ? page : null });
});

// ---- Storage sync ----

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let dirty = false;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key === KEY.settings) {
      const wasEnabled = settings.enabled;
      settings = normalizeSettings(newValue);
      if (wasEnabled !== settings.enabled && page) void onPage(page);
      if (!settings.autoSkip || !settings.enabled) cancelSkip();
      if (!checksOn(settings)) checker.stop();
      if (!autoFeedbackOn(settings)) autoQueue.clear();
      dirty = true;
    } else if (key === KEY.overrides) {
      overrides = (newValue as Overrides) ?? {};
      dirty = true;
    } else if (key === KEY.dontrec) {
      dontrecs = (newValue as DontRecs) ?? {};
      dirty = true;
    } else if (key === KEY.vmap) {
      vmap = (newValue as Record<string, string>) ?? {};
      dirty = true;
    } else if (isChannelKey(key)) {
      const id = key.slice(2);
      if (channels.has(id)) {
        channels.set(id, (newValue as ChannelRecord) ?? null);
        dirty = true;
      }
    }
  }
  if (dirty) {
    gen++;
    schedulePass();
    const pageChannelChanged = !!page?.channelId && !!changes[KEY.channel(page.channelId)];
    if (changes[KEY.settings] || changes[KEY.overrides] || pageChannelChanged) refreshPill();
  }
});

function refreshPill(): void {
  if (!page?.channelId) return;
  const channelResult = verdictFor(page.channelId);
  if (!channelResult) return;
  const result = withVideoLabel(channelResult, page.disclosure === 'ai', overrides[page.channelId]);
  pageResult = result;
  renderOwnerBadge(page, result, pillVisible(result));
}

// ---- Boot ----

void (async () => {
  try {
    [settings, overrides, vmap, dontrecs] = await Promise.all([getSettings(), getOverrides(), getVmap(), getDontRecs()]);
  } catch {
    alive();
    return;
  }
  gen++;
  schedulePass();
  document.dispatchEvent(new CustomEvent('botless:request-page'));
})();
