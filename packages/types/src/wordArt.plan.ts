// Word Art — fixture transcript to validated plan, Sprint 2 PR 4.
//
// Closes the contract's own Phase 1 "gate of done" (contracts/29-word-art.md, "Implementation
// phases", Phase 1): "A fixture transcript -> validated plan, no AI, no Adobe." Everything in
// this module is deterministic/fixture-driven scoring, matching Phase 1's own scope line
// ("manual/fixture semantic metadata; scoring model; primitive selection") — no AI, no ALLEN.
//
// Proves, at the package/test level only:
//   fixture transcript segments -> buildWordArtPlanFromSegments -> WordArtPlan/WordArtEvent[]
//                                -> Gate-2 validation (wordArt.validate.js)
//                                -> compileWordArtRenderRequest (wordArt.compile.js)
//                                -> buildSyntheticWordArtRenderResult
//
// Not exported from the main barrel — same reasoning as PR 2/PR 3 — only via
// `@rmg-creator-os/types/wordArt.plan`.

import type { WordArtDensitySummary, WordArtEvent, WordArtImportance, WordArtPlan } from './wordArt.js';

/**
 * The minimal transcript unit this builder consumes. A real Phase 2 analyzer would produce
 * something much richer (speaker, prosody, semantic embeddings); this fixture-level shape only
 * carries what the PROVISIONAL heuristic scorer below actually uses.
 */
export interface TranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  durationMs: number;
}

/**
 * Every scoring/selection value here is **PROVISIONAL** — a fixture-level stand-in for the
 * contract's `W = f(S,E,P,B,C,T)` scoring model and the primitive/motion-profile selection
 * step, not a frozen creative strategy. Callers supply it explicitly; nothing here is
 * hardcoded as "the" scoring rule.
 */
export interface WordArtPlanBuilderConfig {
  configVersion: string;
  productionId: string;
  sourceAssetId: string;
  sourceTranscriptRef: string;
  autonomyLevel: string;
  /** A segment becomes a Word Art event when its heuristic score meets this — PROVISIONAL. */
  heroScoreThreshold: number;
  minReadableMs: number;
  minSpacingMs: number;
  /** Keywords whose presence nudges a segment toward "declaration"-style emphasis —
   * PROVISIONAL fixture heuristic, not a real semantic/rhetorical classifier. */
  emphasisKeywords: string[];
  defaultPrimitive: string;
  defaultMotionProfile: string;
  defaultBrandProfile: string;
  defaultTypographyProfileRef: string;
  defaultAnchor: string;
}

/**
 * PROVISIONAL fixture heuristic standing in for the contract's real scoring model. Scores a
 * segment in `[0,1]` from three cheap, deterministic signals: presence of a configured
 * emphasis keyword, an exclamation mark, and a "short and punchy" word count — none of this is
 * semantic understanding, it is a fixture-level surrogate so Phase 1 can be proven without AI.
 */
export function scoreSegment(segment: TranscriptSegment, config: WordArtPlanBuilderConfig): number {
  const text = segment.text.toLowerCase();
  const wordCount = segment.text.trim().split(/\s+/).filter(Boolean).length;

  let score = 0;
  if (config.emphasisKeywords.some((kw) => text.includes(kw.toLowerCase()))) score += 0.5;
  if (segment.text.includes('!')) score += 0.2;
  if (wordCount > 0 && wordCount <= 6) score += 0.3;

  return Math.min(1, score);
}

function toReasonCode(score: number, threshold: number): string {
  return score >= threshold ? 'HERO_KEYWORD_SHORT_PUNCHY' : 'BELOW_HERO_THRESHOLD';
}

/**
 * Deterministically builds a `WordArtPlan` + its `WordArtEvent`s from fixture transcript
 * segments. Only segments meeting `heroScoreThreshold` become Word Art events — the rest are
 * ordinary captions outside this domain, per the contract's own framing ("Word Art is the
 * selective, governed application of designed typography to the small number of rhetorically
 * important moments", not every line of dialogue). No AI, no network calls, no side effects.
 */
export function buildWordArtPlanFromSegments(
  segments: readonly TranscriptSegment[],
  config: WordArtPlanBuilderConfig
): { plan: WordArtPlan; events: WordArtEvent[] } {
  const now = new Date(0).toISOString(); // deterministic — no wall-clock in a fixture-built plan
  const events: WordArtEvent[] = [];
  const byPrimitive: Record<string, number> = {};

  segments.forEach((segment, index) => {
    const heroScore = scoreSegment(segment, config);
    if (heroScore < config.heroScoreThreshold) return;

    const importance: WordArtImportance = 'cinematic';
    byPrimitive[config.defaultPrimitive] = (byPrimitive[config.defaultPrimitive] ?? 0) + 1;

    events.push({
      contractVersion: '1.0.0',
      id: `wae_${segment.id}`,
      planId: `wap_${config.productionId}`,
      sourceAssetId: config.sourceAssetId,
      sourceTranscriptRef: segment.id,
      seq: index,
      startMs: segment.startMs,
      durationMs: segment.durationMs,
      phrase: segment.text,
      tokens: [],
      emphasisTokenIndexes: [],
      rhetoricalRole: 'declaration',
      heroScore,
      importance,
      confidence: heroScore,
      reasonCode: toReasonCode(heroScore, config.heroScoreThreshold),
      primitive: config.defaultPrimitive,
      motionProfile: config.defaultMotionProfile,
      brandProfile: config.defaultBrandProfile,
      typography: { profileRef: config.defaultTypographyProfileRef },
      composition: { anchor: config.defaultAnchor },
      animationIntensity: { impact: heroScore },
      rendererReqs: [],
      state: 'PROPOSED',
      provenance: { configVersion: config.configVersion }
    });
  });

  const density: WordArtDensitySummary = {
    totalSegments: segments.length,
    wordArtEvents: events.length,
    byPrimitive,
    minSpacingMs: config.minSpacingMs,
    violations: []
  };

  const plan: WordArtPlan = {
    contractVersion: '1.0.0',
    id: `wap_${config.productionId}`,
    productionId: config.productionId,
    configVersion: config.configVersion,
    sourceAssetId: config.sourceAssetId,
    sourceTranscriptRef: config.sourceTranscriptRef,
    autonomyLevel: config.autonomyLevel,
    status: 'proposed',
    events: events.map((e) => e.id),
    density,
    provenance: { configVersion: config.configVersion },
    createdAt: now,
    updatedAt: now
  };

  return { plan, events };
}
