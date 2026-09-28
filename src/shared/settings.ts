import type { Action, Verdict } from './types';

export interface Thresholds {
  /** Share of seen videos carrying the official label needed for "Probably AI". */
  aiRatio: number;
  /** Minimum seen videos before the ratio rule may fire. */
  minVideosForRatio: number;
  /** Seen videos with zero labels needed before absence counts as (weak) human evidence. */
  humanMinVideos: number;
  /** Community votes needed before they affect the verdict (phase 2). */
  minVotes: number;
  /** Max score contribution of a unanimous community vote (phase 2). */
  voteWeight: number;
  /** score >= aiScore -> "Probably AI". */
  aiScore: number;
  /** score <= humanScore -> "Probably Human". */
  humanScore: number;
}

export interface Settings {
  enabled: boolean;
  thresholds: Thresholds;
  actions: Record<Verdict, Action>;
  autoSkip: boolean;
  /**
   * Master gate for everything that talks to YouTube beyond the page you're on (popup: "Active mode").
   * Off (default): fully local, verdicts only come from what you watch, nothing is sent anywhere.
   * On: enables the sub-features below (background checks, "Don't recommend" / "Not interested").
   */
  youtubeRequests: boolean;
  /** Under the gate: look up YouTube's AI label for channels on screen before you watch (src/shared/check.ts). */
  backgroundChecks: boolean;
  /** Max background-check requests per day, across all tabs. No documented YouTube limit exists: 150 is a cautious default. */
  checkDailyLimit: number;
  /** Under the gate (on by default): automatically use "Don't recommend channel" / "Not interested" on Probably AI content. */
  autoDontRecommend: boolean;
  /** `next` uses the player's Next button (autoplay/playlist); `back` goes to the previous page. */
  skipTarget: 'next' | 'back';
  skipDelaySeconds: number;
  /** Cached channel verdicts older than this are recomputed. */
  cacheTtlDays: number;
  /** Channels not seen for this long are forgotten (overrides are never purged). */
  observationTtlDays: number;
  /** Settings format version, for one-off migrations (see normalizeSettings). */
  version: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  thresholds: {
    aiRatio: 0.9,
    minVideosForRatio: 2,
    humanMinVideos: 5,
    minVotes: 5,
    voteWeight: 0.8,
    aiScore: 0.7,
    humanScore: -0.3,
  },
  actions: { ai: 'badge', inconclusive: 'badge', human: 'none' },
  autoSkip: false,
  youtubeRequests: false,
  backgroundChecks: true,
  checkDailyLimit: 150,
  autoDontRecommend: true,
  skipTarget: 'next',
  skipDelaySeconds: 3,
  cacheTtlDays: 7,
  observationTtlDays: 180,
  version: 2,
};

const ACTIONS: readonly Action[] = ['none', 'badge', 'fade', 'hide'];

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

/**
 * Merge untrusted/partial input (older stored versions, imported JSON) onto defaults,
 * clamping every number so a bad import can't break scoring.
 */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const t = (r.thresholds ?? {}) as Partial<Thresholds>;
  const d = DEFAULT_SETTINGS;
  const dt = d.thresholds;
  const act = (v: unknown, fb: Action): Action => (ACTIONS.includes(v as Action) ? (v as Action) : fb);
  const a = (r.actions ?? {}) as Partial<Record<Verdict, Action>>;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    thresholds: {
      aiRatio: clamp(t.aiRatio, 0.05, 1, dt.aiRatio),
      minVideosForRatio: Math.round(clamp(t.minVideosForRatio, 1, 100, dt.minVideosForRatio)),
      humanMinVideos: Math.round(clamp(t.humanMinVideos, 1, 1000, dt.humanMinVideos)),
      minVotes: Math.round(clamp(t.minVotes, 1, 10000, dt.minVotes)),
      voteWeight: clamp(t.voteWeight, 0, 1, dt.voteWeight),
      aiScore: clamp(t.aiScore, 0.05, 1, dt.aiScore),
      humanScore: clamp(t.humanScore, -1, -0.05, dt.humanScore),
    },
    actions: {
      ai: act(a.ai, d.actions.ai),
      inconclusive: act(a.inconclusive, d.actions.inconclusive),
      // Hiding/fading "Probably Human" makes no sense; only none/badge are allowed.
      human: a.human === 'badge' ? 'badge' : 'none',
    },
    autoSkip: typeof r.autoSkip === 'boolean' ? r.autoSkip : d.autoSkip,
    // Settings saved before the gate existed: the gate is on if a YouTube feature was on, and background checks
    // (now just a sub-option) default to on so that flipping the gate later does what users expect.
    youtubeRequests: typeof r.youtubeRequests === 'boolean' ? r.youtubeRequests : !!(r.backgroundChecks || r.autoDontRecommend),
    backgroundChecks: r.youtubeRequests === undefined ? d.backgroundChecks : typeof r.backgroundChecks === 'boolean' ? r.backgroundChecks : d.backgroundChecks,
    checkDailyLimit: Math.round(clamp(r.checkDailyLimit, 10, 1000, d.checkDailyLimit)),
    // v2: "Active mode" acts by itself by default. Settings saved before v2 stored the old default (false)
    // without it being a real choice, so they move to the new default once.
    autoDontRecommend: (typeof r.version === 'number' ? r.version : 1) < 2 ? d.autoDontRecommend
      : typeof r.autoDontRecommend === 'boolean' ? r.autoDontRecommend : d.autoDontRecommend,
    skipTarget: r.skipTarget === 'back' ? 'back' : 'next',
    skipDelaySeconds: Math.round(clamp(r.skipDelaySeconds, 1, 15, d.skipDelaySeconds)),
    cacheTtlDays: clamp(r.cacheTtlDays, 0.01, 365, d.cacheTtlDays),
    observationTtlDays: clamp(r.observationTtlDays, 1, 3650, d.observationTtlDays),
    version: d.version,
  };
}

/** Effective switches: every YouTube-facing feature needs Botless on AND the "Active mode" gate. */
export const youtubeOn = (s: Settings): boolean => s.enabled && s.youtubeRequests;
export const checksOn = (s: Settings): boolean => youtubeOn(s) && s.backgroundChecks;
export const autoFeedbackOn = (s: Settings): boolean => youtubeOn(s) && s.autoDontRecommend;

/** Stable key for the threshold values; a cached verdict computed under other thresholds is stale. */
export const thresholdsKey = (t: Thresholds): string =>
  [t.aiRatio, t.minVideosForRatio, t.humanMinVideos, t.minVotes, t.voteWeight, t.aiScore, t.humanScore].join('|');
