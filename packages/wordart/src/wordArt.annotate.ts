// Word Art — AI candidate evidence boundary, Sprint 4 PR 1.
//
// Defines what an AI (e.g. ALLEN) may propose about a transcript segment, and the
// deterministic function that folds that evidence into the existing scoring path
// (wordArt.plan.ts's buildWordArtPlanFromSegments). Per contract 29's governing principle:
// "AI understands and directs. Contracts communicate. Deterministic code validates and
// executes." — AI proposes evidence here; it never decides.
//
// AI MAY propose: a rhetorical-role hint, emphasis-token hints, a hero-score hint (semantic
// importance), an emotional-intensity hint, a confidence, a machine reason code, and
// provenance (provider/model/configVersion).
//
// AI MAY NOT propose (and nothing here accepts): a final WordArtEvent/WordArtPlan, an
// authoritative primitive/motionProfile, renderer instructions, or an approval decision. This
// module only ever produces a number that still has to clear the same `heroScoreThreshold`
// and Gate-2 validation every other event does — see `foldAnnotationScore`'s doc comment.
//
// No live ALLEN call, no gateway, no network I/O — this module only shapes and folds evidence
// that's already been fetched and parsed by something else (Sprint 4 PR 2, apps/gateway).

/**
 * What an AI is permitted to propose about one transcript segment. Deliberately narrower than
 * a `WordArtEvent`: no `primitive`, no `motionProfile`, no `brandProfile`, no timing — those
 * stay deterministic-code-owned (`wordArt.plan.ts`'s config defaults). This is evidence, not a
 * decision, mirroring the contract's "every AI output is a candidate decision carrying
 * confidence, provenance, a reason code" rule.
 */
export interface SegmentSemanticAnnotation {
  contractVersion: string;
  /** Which `TranscriptSegment.id` this annotation is about. */
  segmentId: string;
  /** PROVISIONAL open vocabulary, same status as `WordArtEvent.rhetoricalRole`. */
  rhetoricalRoleHint?: string;
  /** Indexes into the segment's words the AI flags as emphasized — a hint, not the event's
   * final `emphasisTokenIndexes`. */
  emphasisTokenHints?: number[];
  /** `[0,1]` — the AI's suggested semantic importance. A hint: see `foldAnnotationScore`. */
  heroScoreHint: number;
  /** `[0,1]`, optional — not yet folded into scoring (Sprint 4 PR 1 scope is hero-score only);
   * carried through for provenance/future use. */
  emotionalIntensityHint?: number;
  /** `[0,1]` — the AI's confidence in this annotation, not in a treatment decision. */
  confidence: number;
  /** Machine reason code, not free-form prose — same discipline as every other Word Art
   * artifact's `reasonCode`. */
  reasonCode: string;
  provider: string;
  model?: string;
  configVersion?: string;
}

/** The subset of `WordArtPlanBuilderConfig` `foldAnnotationScore` needs. Defined locally
 * (not imported from `wordArt.plan.ts`) to avoid a circular module dependency — `wordArt.plan.ts`
 * imports from this file, not the other way around. */
export interface AnnotationFoldingConfig {
  /** Below this, an annotation contributes nothing — the heuristic score decides alone. This
   * is the line that keeps AI confidence from ever being able to bypass deterministic scoring:
   * a low-confidence annotation is simply ignored, not weighted down. PROVISIONAL default
   * `DEFAULT_MIN_ANNOTATION_CONFIDENCE`. */
  minAnnotationConfidence?: number;
  /** `[0,1]` — how much weight the annotation's `heroScoreHint` gets in the blend once the
   * confidence floor is met; the heuristic score keeps `1 - annotationWeight`. PROVISIONAL
   * default `DEFAULT_ANNOTATION_WEIGHT`. */
  annotationWeight?: number;
}

export const DEFAULT_MIN_ANNOTATION_CONFIDENCE = 0.5;
export const DEFAULT_ANNOTATION_WEIGHT = 0.6;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Deterministically folds an AI-proposed annotation into a heuristic score. This is the whole
 * boundary in one function:
 *
 * - No annotation, or confidence below `minAnnotationConfidence` → the heuristic score is
 *   returned unchanged. The annotation is evidence that didn't clear the bar; it is *ignored*,
 *   never treated as a veto or a downweight — deterministic code decided nothing changes.
 * - Confidence at or above the floor → the annotation's `heroScoreHint` is blended with the
 *   heuristic score at `annotationWeight`. It can move the resulting score, but the result
 *   still has to clear `heroScoreThreshold` in the caller and pass Gate 2 like any other
 *   event — a confident annotation cannot itself produce or approve an event.
 *
 * PROVISIONAL blend, same status as `wordArt.plan.ts`'s `scoreSegment` heuristic itself.
 */
export function foldAnnotationScore(
  heuristicScore: number,
  annotation: SegmentSemanticAnnotation | undefined,
  config: AnnotationFoldingConfig
): number {
  if (!annotation) return heuristicScore;

  const minConfidence = config.minAnnotationConfidence ?? DEFAULT_MIN_ANNOTATION_CONFIDENCE;
  if (annotation.confidence < minConfidence) return heuristicScore;

  const weight = clamp01(config.annotationWeight ?? DEFAULT_ANNOTATION_WEIGHT);
  const hint = clamp01(annotation.heroScoreHint);
  return clamp01(weight * hint + (1 - weight) * heuristicScore);
}
