/**
 * Channel verdict scoring — PURE. No DOM, no chrome.*, no clock. Safe to unit test and tune.
 *
 * Model
 * -----
 * Each signal adds a signed contribution to a score in [-1, 1] (positive = leans AI).
 * The final score maps to a verdict:
 *
 *     score >= thresholds.aiScore     -> "Probably AI"
 *     score <= thresholds.humanScore  -> "Probably Human"
 *     otherwise, if any signal fired  -> "Inconclusive"
 *     no signal at all                -> null (no badge)
 *
 * Signals, strongest first:
 *
 *  1. Manual override (the user's own mark) — short-circuits everything. Always wins for that user.
 *
 *  2. Official disclosure ratio — share of this channel's videos *that this user has watched*
 *     that carry YouTube's own "Made with AI" / "Altered or synthetic content" label.
 *     - ratio >= aiRatio with at least minVideosForRatio videos  -> +WEIGHTS.ratioHit (enough for AI alone)
 *     - some labeled videos, but below the bar                  -> +WEIGHTS.partialBase + WEIGHTS.partialSlope * ratio
 *       (deliberately < aiScore: a creator who used AI once is not an "AI channel")
 *
 *  3. Absence of labels — humanMinVideos+ videos watched and none labeled -> WEIGHTS.noLabels (negative).
 *     Weak on purpose: many creators never disclose. Enough for "Probably Human" only if nothing contradicts it.
 *
 *  4. Community votes (phase 2) — ignored until ai+human >= minVotes. Then contributes
 *     voteWeight * (ai - human) / (ai + human), i.e. unanimous votes = ±voteWeight.
 *
 * Tuning: change WEIGHTS below or the user-facing Thresholds in settings.ts. Tests in
 * tests/scoring.test.ts pin the intended behaviour of each rule.
 */
import type { Thresholds } from './settings';
import type { Reason, VerdictResult, VoteCounts } from './types';

export const WEIGHTS = {
  /** Ratio rule fired: official labels on (almost) every seen video. */
  ratioHit: 1.0,
  /** Some labeled videos, ratio rule not met: base + slope * ratio. Max 0.6 < default aiScore 0.7. */
  partialBase: 0.3,
  partialSlope: 0.3,
  /** Many seen videos, zero labels. */
  noLabels: -0.5,
} as const;

export interface ScoringInput {
  /** Distinct videos of this channel whose disclosure we have checked. */
  videosSeen: number;
  /** How many of those carried the official AI label. */
  videosLabeled: number;
  votes?: VoteCounts;
  override?: 'ai' | 'human' | null;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function computeVerdict(input: ScoringInput, t: Thresholds): VerdictResult {
  if (input.override) {
    const ai = input.override === 'ai';
    return {
      verdict: input.override,
      score: ai ? 1 : -1,
      reasons: [{ signal: 'override', text: `You marked this channel as ${ai ? 'AI' : 'human'}`, weight: ai ? 1 : -1 }],
    };
  }

  const reasons: Reason[] = [];
  const n = Math.max(0, Math.floor(input.videosSeen));
  const k = Math.min(n, Math.max(0, Math.floor(input.videosLabeled)));

  if (k > 0) {
    const ratio = k / n;
    const label = `${k} of ${plural(n, 'video')} you've watched ${k === 1 ? 'carries' : 'carry'} YouTube's AI label`;
    if (n >= t.minVideosForRatio && ratio >= t.aiRatio) {
      reasons.push({ signal: 'ratio', text: `${label} (${pct(ratio)} ≥ ${pct(t.aiRatio)})`, weight: WEIGHTS.ratioHit });
    } else {
      const why = n < t.minVideosForRatio ? `need ${t.minVideosForRatio}+ videos to judge` : `below the ${pct(t.aiRatio)} bar`;
      reasons.push({
        signal: 'disclosure',
        text: `${label} — ${why}`,
        weight: WEIGHTS.partialBase + WEIGHTS.partialSlope * ratio,
      });
    }
  } else if (n >= t.humanMinVideos) {
    reasons.push({ signal: 'no-labels', text: `None of the ${n} videos you've watched carry an AI label`, weight: WEIGHTS.noLabels });
  }

  const ai = Math.max(0, input.votes?.ai ?? 0);
  const human = Math.max(0, input.votes?.human ?? 0);
  const total = ai + human;
  if (total >= t.minVotes) {
    const w = (t.voteWeight * (ai - human)) / total;
    reasons.push({ signal: 'votes', text: `Community: ${ai} AI vs ${human} human votes`, weight: w });
  } else if (total > 0) {
    reasons.push({ signal: 'votes', text: `Community: ${plural(total, 'vote')} so far (needs ${t.minVotes})`, weight: 0 });
  }

  const active = reasons.filter((r) => r.weight !== 0);
  const score = Math.max(-1, Math.min(1, active.reduce((s, r) => s + r.weight, 0)));
  if (active.length === 0) return { verdict: null, score: 0, reasons };

  const verdict = score >= t.aiScore ? 'ai' : score <= t.humanScore ? 'human' : 'inconclusive';
  return { verdict, score, reasons };
}

/** User-facing label. Never claims certainty. */
export const VERDICT_LABEL = {
  ai: 'Probably AI',
  human: 'Probably Human',
  inconclusive: 'Inconclusive',
} as const;
