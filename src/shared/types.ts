/** A channel verdict. Always presented to users as "Probably …" — never as certainty. */
export type Verdict = 'human' | 'ai' | 'inconclusive';

/** What to do with a thumbnail whose channel has a verdict. `fade` and `badge` both show the badge. */
export type Action = 'none' | 'badge' | 'fade' | 'hide';

/** Which signal produced a reason line. Mirrors the signals in scoring.ts. */
export type Signal = 'override' | 'ratio' | 'disclosure' | 'no-labels' | 'votes';

export interface Reason {
  signal: Signal;
  /** Human-readable sentence shown in the popup and badge tooltip. */
  text: string;
  /** Contribution to the score. 0 means "informational only, did not affect the verdict". */
  weight: number;
}

export interface VerdictResult {
  /** null = no evidence at all; show nothing. */
  verdict: Verdict | null;
  /** Clamped to [-1, 1]. Positive leans AI, negative leans human. */
  score: number;
  reasons: Reason[];
}

export interface VoteCounts {
  ai: number;
  human: number;
}

/** Everything we have locally observed about one channel. Stored under `c:<channelId>`. */
export interface ChannelRecord {
  id: string;
  name?: string;
  /**
   * videoId -> 1 if YouTube showed its "Made with AI" disclosure, 0 if not.
   * Insertion-ordered; oldest entries are dropped past MAX_VIDEOS_PER_CHANNEL.
   */
  videos: Record<string, 0 | 1>;
  /** Phase 2: community vote tallies. Absent in phase 1. */
  votes?: VoteCounts;
  firstSeen: number;
  lastSeen: number;
  /** Cached verdict; recomputed after cacheTtlDays or when settings change. */
  cached?: CachedVerdict;
}

export interface CachedVerdict extends VerdictResult {
  computedAt: number;
  /** Hash of the thresholds used, so a settings change invalidates the cache. */
  thresholdsKey: string;
}

export interface Override {
  verdict: 'ai' | 'human';
  name?: string;
  at: number;
}

export type Overrides = Record<string, Override>;

/** Result of reading YouTube's own disclosure for one video. */
export type Disclosure = 'ai' | 'auto-dubbed' | 'none';

export type PageType = 'watch' | 'shorts' | 'channel' | 'other';

/** What the MAIN-world bridge reports about the current page. */
export interface PageInfo {
  pageType: PageType;
  url: string;
  videoId?: string;
  channelId?: string;
  channelName?: string;
  disclosure?: Disclosure;
  /** Where the disclosure answer came from, for debugging/README honesty. */
  disclosureSource?: 'data' | 'dom' | 'unknown';
}

/** A channel Botless told YouTube not to recommend. YouTube's own Undo is the way back; we never repeat it. */
export interface DontRecommend {
  at: number;
  name?: string;
  auto: boolean;
}

export type DontRecs = Record<string, DontRecommend>;

export interface CheckStats {
  day: string;
  /** Background checks done today, across all tabs. */
  count: number;
  /** Epoch ms until which checks are paused after YouTube pushed back (429/403/5xx). */
  backoffUntil?: number;
}

export interface DailyStats {
  day: string;
  /** Distinct video IDs flagged "Probably AI" today (capped). */
  ids: string[];
}
