/**
 * Isolated-world content script. Reads the IDs the MAIN-world bridge stamped onto tiles, looks up
 * verdicts in chrome.storage.local, and renders badges / fade / hide, the watch-page pill and auto-skip.
 * All writes go through the service worker so concurrent tabs can't clobber each other.
 */
import { isSwError, type ChannelSummary, type SwRequest, type TabRequest, type TabResponse } from '../shared/messages';
import { checksOn, normalizeSettings, type Settings } from '../shared/settings';
import { getChannels, getOverrides, getSettings, getVmap, isChannelKey, KEY } from '../shared/storage';
import type { ChannelRecord, Overrides, PageInfo, VerdictResult } from '../shared/types';
import { isChannelId, isVideoId, parsePageInfo } from '../shared/validate';
import { resolveVerdict, withVideoLabel } from '../shared/verdict';
import { checkNeed } from '../shared/check';
import { applyTile, clearTile, hasBadge } from './badges';
import { createChecker } from './checker';
import { cancelSkip, maybeSkip, renderOwnerBadge } from './watch';

let settings: Settings = normalizeSettings(undefined);
let overrides: Overrides = {};
let vmap: Record<string, string> = {};
/** undefined = not loaded yet, null = loaded and unknown to us. */
const channels = new Map<string, ChannelRecord | null>();
/**
 * Part of each tile's applied signature: bumping it re-renders tiles. `gen` covers what affects every tile
 * (settings, marks, the video map); `chGen` one channel's data, so an observation (every background check
 * makes one) only re-renders that channel's tiles instead of every badge on the page.
 */
let gen = 0;
const chGen = new Map<string, number>();
const bumpChannel = (cid: string): void => void chGen.set(cid, (chGen.get(cid) ?? 0) + 1);
let page: PageInfo | null = null;
let pageResult: VerdictResult | null = null;
/**
 * False until the user's settings are loaded. Until then only the defaults (Botless on) are known, so page
 * events and scans are ignored; boot asks the bridge to re-send the current page once it's ready.
 */
let booted = false;

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
    return chrome.runtime.sendMessage(msg).then(
      (r) => (isSwError(r) ? undefined : r), // a failed handler answers { error }: treat it as no answer
      () => (alive(), undefined),
    );
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
}
addEventListener('scroll', onScroll, { passive: true });
document.addEventListener('visibilitychange', onVisibility);

// ---- Tile pass (runs after each debounced bridge scan) ----

function pass(): void {
  if (!booted || !alive()) return;
  const tiles = document.querySelectorAll<HTMLElement>('[data-botless-key], [data-botless-applied]');
  // Layout reads first, all together: reading positions between the DOM writes below would force a layout per tile.
  const visible = checksOn(settings) ? new Set([...tiles].filter((el) => el.dataset.botlessVid && onScreen(el))) : null;
  for (const el of tiles) {
    // The page can set these attributes too: only well-formed IDs are used (and learned).
    const vid = isVideoId(el.dataset.botlessVid) ? el.dataset.botlessVid : undefined;
    let cid = isChannelId(el.dataset.botlessCid) ? el.dataset.botlessCid : undefined;
    // Pairs read from YouTube's data are remembered; ones the bridge inferred from context are only displayed.
    // With Botless off, nothing is learned (the bridge still stamps tiles: it can't read the settings).
    if (settings.enabled && vid && cid && vmap[vid] !== cid && !el.dataset.botlessInferred) pendingPairs.set(vid, cid);
    cid ??= vid ? vmap[vid] : undefined;
    if (!settings.enabled || !cid || !el.dataset.botlessKey) {
      // Channel-less tile (a Short): checking its video reveals both its channel and its AI label.
      if (visible?.has(el) && vid && !cid && el.dataset.botlessKey) checker.offer(vid, null);
      if (el.dataset.botlessApplied) clearTile(el);
      continue;
    }
    const channelResult = verdictFor(cid);
    if (!channelResult) continue; // loading; the load callback schedules another pass
    if (visible?.has(el) && vid && checkNeed(channels.get(cid) ?? undefined, overrides[cid])) {
      checker.offer(vid, cid);
    }
    // A video carrying YouTube's own AI label is AI content even if its channel isn't judged yet.
    const result = withVideoLabel(channelResult, !!vid && channels.get(cid)?.videos[vid] === 1, overrides[cid]);
    const action = result.verdict ? settings.actions[result.verdict] : 'none';
    const needsBadge = action === 'badge' || action === 'fade';
    const sig = `${el.dataset.botlessKey}|${result.verdict}|${action}|${gen}.${chGen.get(cid) ?? 0}`;
    if (el.dataset.botlessApplied === sig && (!needsBadge || hasBadge(el))) continue;
    if (action === 'none') clearTile(el);
    else if (!applyTile(el, result, action)) continue; // thumbnail not rendered yet; retry next pass
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
  if (!summary?.result || page !== info) return; // no answer, or navigated away meanwhile
  channels.set(info.channelId, summary.record ?? null);
  // The video playing right now carries YouTube's AI label: AI for this video (auto-skips labeled Shorts too).
  pageResult = withVideoLabel(summary.result, info.disclosure === 'ai', summary.override);
  bumpChannel(info.channelId);
  schedulePass();

  renderOwnerBadge(info, pageResult, pillVisible(pageResult));
  if (pageResult.verdict === 'ai') {
    noteFlagged(info.videoId);
    maybeSkip(info, pageResult, settings);
  }
}

function onPageEvent(e: Event): void {
  const detail = (e as CustomEvent<string>).detail;
  if (!booted || typeof detail !== 'string' || !alive()) return;
  // Any script in the page can dispatch this event: accept only well-formed info about the page actually shown.
  let info: PageInfo | null = null;
  try {
    info = parsePageInfo(JSON.parse(detail), location.href);
  } catch {
    /* not JSON */
  }
  if (info) void onPage(info);
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
  let dirty = false; // affects every tile
  let channelDirty = false;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key === KEY.settings) {
      const wasEnabled = settings.enabled;
      settings = normalizeSettings(newValue);
      if (wasEnabled !== settings.enabled && page) void onPage(page);
      if (!settings.autoSkip || !settings.enabled) cancelSkip();
      if (!checksOn(settings)) checker.stop();
      dirty = true;
    } else if (key === KEY.overrides) {
      overrides = (newValue as Overrides) ?? {};
      dirty = true;
    } else if (key === KEY.vmap) {
      vmap = (newValue as Record<string, string>) ?? {};
      channelDirty = true; // a newly mapped Short changes its own verdict, which is part of its signature
    } else if (isChannelKey(key)) {
      const id = key.slice(2);
      if (channels.has(id)) {
        channels.set(id, (newValue as ChannelRecord) ?? null);
        bumpChannel(id); // only this channel's tiles
        channelDirty = true;
      }
    }
  }
  if (dirty) gen++;
  if (dirty || channelDirty) {
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
    [settings, overrides, vmap] = await Promise.all([getSettings(), getOverrides(), getVmap()]);
  } catch {
    alive();
    return;
  }
  booted = true;
  gen++;
  schedulePass();
  document.dispatchEvent(new CustomEvent('botless:request-page'));
})();
