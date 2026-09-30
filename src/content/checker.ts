/**
 * Opt-in background checks (off by default; switch in the popup). Looks up YouTube's AI label for channels whose
 * tiles are on screen, so verdicts appear before the user watches anything. Pure parsing lives in
 * src/shared/check.ts; this file only schedules and fetches.
 *
 * - One request at a time per tab, newest on-screen tiles first.
 * - Every request first asks the service worker for a slot: it spaces requests across ALL tabs and
 *   enforces the daily cap and back-off.
 * - Requests go to www.youtube.com only, with `credentials: "omit"` (no cookies → not tied to the account,
 *   can't touch watch history or recommendations) and `redirect: "error"` (a redirect, e.g. to a consent or
 *   bot-check page, fails instead of sending a request to another host).
 * - Any failure (HTTP error, redirect, network error, unreadable answer) is reported so the service worker
 *   pauses checks for every tab.
 * - Results are recorded exactly like a watched video (`observe`), so the normal scoring applies.
 */
import {
  checkNeed,
  FALLBACK_CLIENT_VERSION,
  nextRequestBody,
  parseChannelFeed,
  parseNextResponse,
  pickConfirmVideo,
  type CheckResult,
} from '../shared/check';
import type { ChannelSummary, CheckPermit, SwRequest } from '../shared/messages';
import type { ChannelRecord, Override } from '../shared/types';

const MAX_PENDING = 40;

export interface CheckerDeps {
  send: (msg: SwRequest) => Promise<any>;
  record: (channelId: string) => ChannelRecord | undefined;
  override: (channelId: string) => Override | undefined;
  /** Enabled, opted in, extension still connected, tab visible. */
  active: () => boolean;
}

/**
 * 'video'   — check this specific video.
 * 'confirm' — the channel has exactly one (labeled) video: look up its feed and check one more.
 */
/** channelId null = a tile that doesn't say its channel (Shorts): the check reveals it. */
type Job = { kind: 'video'; videoId: string; channelId: string | null } | { kind: 'confirm'; channelId: string };

export function createChecker(deps: CheckerDeps) {
  /** Tiles on screen: videoId -> channelId (null if unknown), insertion order = offer order (newest last). */
  const pending = new Map<string, string | null>();
  /** Videos picked from a channel feed to confirm a single label: videoId -> channelId. Served first. */
  const confirmVideos = new Map<string, string>();
  const confirms = new Set<string>();
  /** Videos / channel feeds this tab already checked (or failed to): never retried in this tab. */
  const tried = new Set<string>();
  const confirmTried = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  /**
   * True while the page is being left (reload, full navigation). The browser then aborts our fetch, which
   * says nothing about YouTube: reporting it would pause checks in every tab for CHECK_BACKOFF_MS.
   */
  let leaving = false;
  addEventListener('pagehide', () => (leaving = true));
  addEventListener('pageshow', () => (leaving = false)); // back from the back/forward cache

  /**
   * Redirected, offline, blocked by another extension, or not JSON (e.g. a consent page): back off. Reported a
   * moment later, and only if the page is still here: for a typed URL or a bookmark, Chrome rejects the aborted
   * fetch before pagehide fires, and a page being left never runs the timer.
   */
  const networkFailed = (): void => {
    setTimeout(() => {
      if (!leaving) void deps.send({ type: 'checkFailed', status: 0 });
    }, 1000);
  };

  const clientVersion = () => document.documentElement.dataset.botlessClient || FALLBACK_CLIENT_VERSION;

  function kick(delayMs = 0): void {
    if (timer !== undefined || running) return;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delayMs);
  }

  /**
   * Records from the service worker's replies. The page's copy (deps.record) only catches up when
   * chrome.storage.onChanged fires, which can be after the reply: judging by it alone dropped every confirmation.
   */
  const replied = new Map<string, ChannelRecord>();
  const latest = (channelId: string): ChannelRecord | undefined => {
    const page = deps.record(channelId);
    const mine = replied.get(channelId);
    return mine && (!page || mine.lastSeen > page.lastSeen) ? mine : page;
  };
  const need = (channelId: string) => checkNeed(latest(channelId), deps.override(channelId));

  function takeNext(): Job | null {
    for (const [videoId, channelId] of confirmVideos) {
      confirmVideos.delete(videoId);
      if (!tried.has(videoId) && need(channelId) === 'confirm') return { kind: 'video', videoId, channelId };
    }
    for (const channelId of confirms) {
      confirms.delete(channelId);
      if (!confirmTried.has(channelId) && need(channelId) === 'confirm') return { kind: 'confirm', channelId };
    }
    for (const [videoId, channelId] of [...pending].reverse()) {
      pending.delete(videoId);
      if (channelId === null) {
        if (!tried.has(videoId)) return { kind: 'video', videoId, channelId: null };
        continue;
      }
      const n = need(channelId);
      if (n === 'video' && !tried.has(videoId)) return { kind: 'video', videoId, channelId };
      // e.g. a channel left at "1 labeled video" by an earlier session: confirm it now.
      if (n === 'confirm' && !confirmTried.has(channelId)) return { kind: 'confirm', channelId };
    }
    return null;
  }

  function requeue(job: Job): void {
    if (job.kind === 'confirm') confirms.add(job.channelId);
    else if (job.channelId !== null && need(job.channelId) === 'confirm') confirmVideos.set(job.videoId, job.channelId);
    else pending.set(job.videoId, job.channelId);
  }

  /** Anything but a well-formed answer (no answer, an error) means "not now": never retry in a tight loop. */
  async function permit(): Promise<CheckPermit> {
    const p = (await deps.send({ type: 'checkPermit' })) as Partial<CheckPermit> | undefined;
    if (p?.ok === true) return { ok: true };
    if (p?.ok === false && typeof p.retryAfterMs === 'number' && p.retryAfterMs > 0) return p as CheckPermit;
    return { ok: false, retryAfterMs: 60_000, reason: 'off' };
  }

  async function fetchVideo(videoId: string): Promise<CheckResult | null> {
    tried.add(videoId);
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: nextRequestBody(videoId, clientVersion()),
      });
      if (!res.ok) {
        void deps.send({ type: 'checkFailed', status: res.status });
        return null;
      }
      return parseNextResponse(await res.json());
    } catch {
      networkFailed();
      return null;
    }
  }

  async function saveResult(videoId: string, fallbackChannel: string | null, r: CheckResult): Promise<void> {
    if (r.disclosure === null) return; // unknown response format: record nothing rather than a false "no label"
    const channelId = r.channelId ?? fallbackChannel; // the response's owner wins (it's authoritative)
    if (!channelId) return;
    // Channel-less tile (Short): remember which channel it belongs to, so the tile can be judged from now on.
    if (fallbackChannel === null) void deps.send({ type: 'learnVideos', pairs: [[videoId, channelId]] });
    const summary = (await deps.send({
      type: 'observe',
      channelId,
      name: r.channelName,
      videoId,
      labeled: r.disclosure === 'ai',
    })) as ChannelSummary | undefined;
    if (summary?.record) replied.set(channelId, summary.record);
    if (summary && checkNeed(summary.record, summary.override) === 'confirm') confirms.add(channelId);
  }

  /** Returns how long to wait before the next job. */
  async function process(job: Job): Promise<number> {
    const p = await permit();
    if (!p.ok) {
      requeue(job);
      return p.retryAfterMs;
    }
    if (job.kind === 'video') {
      const r = await fetchVideo(job.videoId);
      if (r) await saveResult(job.videoId, job.channelId, r);
      return 0;
    }
    // Confirm: the channel's feed tells us its latest videos; check the newest one we haven't seen.
    confirmTried.add(job.channelId);
    let feed: string[] = [];
    try {
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(job.channelId)}`, {
        credentials: 'omit',
        redirect: 'error',
      });
      if (res.ok) feed = parseChannelFeed(await res.text());
      else void deps.send({ type: 'checkFailed', status: res.status });
    } catch {
      networkFailed();
    }
    const videoId = pickConfirmVideo(feed, latest(job.channelId));
    if (videoId && !tried.has(videoId)) confirmVideos.set(videoId, job.channelId); // checked next, with its own permit
    return 0;
  }

  async function run(): Promise<void> {
    if (!deps.active()) return; // resumes on the next offer / visibility change
    const job = takeNext();
    if (!job) return;
    running = true;
    let delay = 0;
    try {
      delay = await process(job);
    } finally {
      running = false;
    }
    if (pending.size || confirms.size || confirmVideos.size) kick(delay);
  }

  return {
    /** A tile whose channel may need a check is on screen. */
    offer(videoId: string, channelId: string | null): void {
      if (tried.has(videoId)) return;
      pending.delete(videoId);
      pending.set(videoId, channelId);
      if (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value!);
      kick();
    },
    resume(): void {
      if (pending.size || confirms.size || confirmVideos.size) kick();
    },
    stop(): void {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
      confirms.clear();
      confirmVideos.clear();
    },
  };
}
