// Word Art — Gate 2 (deterministic contract validation), Sprint 2 PR 2.
//
// Validates `WordArtEvent` and `WordArtPlan` candidates (typically AI-proposed) against the
// domain contract in `./wordArt.ts` / rmg-piaar-system's `contracts/word-art/`, following the
// same parse-not-cast pattern as Sprint 1's `apps/gateway/src/allen.schemas.ts` (`parseAllen`):
// PERMISSIVE on fields the contract marks optional/PROVISIONAL, STRICT on the fields Gate 2
// itself defines (ranges, ordering, required references) — see each rule's contract citation.
//
// Scope: schema/shape/range validation only. No allow-list resolution against a live brand/
// primitive/motion config (no such config exists yet — see "Known limitations" below), no
// routes, no DB, no renderer wiring, no plan/event generation. Gate 1 (creative approval),
// Gate 3 (preview/QA), and Gate 4 (delivery) are out of scope here.

import { z } from 'zod';
import type { WordArtEvent, WordArtPlan } from './wordArt.js';

const unitInterval = z.number().min(0).max(1);

/** `word-art-event.md` Gate 2 rules: durations/timing, unit-interval scores, non-empty
 * references. `primitive`/`motionProfile`/`brandProfile` are checked for presence and shape
 * only — resolving them against the active config allow-list is explicitly a config-driven
 * step this package does not own (see Known limitations). */
export const WordArtEventSchema = z
  .object({
    contractVersion: z.string().min(1),
    id: z.string().min(1),
    planId: z.string().min(1),
    sourceAssetId: z.string().min(1),
    sourceTranscriptRef: z.string().min(1),
    seq: z.number().int().min(0),
    startMs: z.number().int().min(0),
    durationMs: z.number().int().positive(), // no zero/negative duration (contract rule)
    phrase: z.string().min(1),
    tokens: z
      .array(
        z.object({
          text: z.string().min(1),
          semanticWeight: unitInterval,
          prosodyWeight: unitInterval,
          role: z.string().min(1)
        })
      )
      .default([]),
    emphasisTokenIndexes: z.array(z.number().int().min(0)).default([]),
    rhetoricalRole: z.string().min(1),
    heroScore: unitInterval,
    importance: z.enum(['standard', 'cinematic']),
    confidence: unitInterval,
    reasonCode: z.string().min(1),
    primitive: z.string().min(1),
    motionProfile: z.string().min(1),
    brandProfile: z.string().min(1),
    typography: z.object({ profileRef: z.string().min(1), case: z.string().optional() }),
    composition: z.object({ anchor: z.string().min(1), safeZone: z.string().optional() }),
    // DECIDED (word-art-event.md): normalized [0,1]; no raw keyframe fields permitted here.
    animationIntensity: z.record(z.string(), unitInterval),
    rendererReqs: z.array(z.string().min(1)).default([]),
    alternatives: z
      .array(z.object({ primitive: z.string().min(1), confidence: unitInterval }))
      .optional(),
    state: z.string().min(1),
    provenance: z.record(z.string(), z.unknown()).default({}),
    validation: z.object({ status: z.string() }).optional(),
    qa: z.object({ status: z.string() }).optional()
  })
  .passthrough();

/** `word-art-plan.md` density summary — deterministic, computed by the plan composer. */
export const WordArtDensitySummarySchema = z
  .object({
    totalSegments: z.number().int().min(0),
    wordArtEvents: z.number().int().min(0),
    byPrimitive: z.record(z.string(), z.number().int().min(0)).default({}),
    minSpacingMs: z.number().int().min(0),
    violations: z.array(z.string()).default([])
  })
  .passthrough();

export const WordArtPlanSchema = z
  .object({
    contractVersion: z.string().min(1),
    id: z.string().min(1),
    productionId: z.string().min(1),
    configVersion: z.string().min(1), // DECIDED — plan must be reproducible under a resolvable config
    sourceAssetId: z.string().min(1),
    sourceTranscriptRef: z.string().min(1),
    autonomyLevel: z.string().min(1),
    status: z.enum(['none', 'analyzing', 'proposed', 'validated', 'rendering', 'complete', 'failed']),
    events: z.array(z.string().min(1)), // ordered event ids — order checked by validatePlanEventOrder
    density: WordArtDensitySummarySchema,
    provenance: z.record(z.string(), z.unknown()).default({}),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .passthrough();

/** Gate 2 config — the density/timing thresholds the contract marks PROVISIONAL and
 * config-driven. No live config source exists yet (see Known limitations); callers may
 * override any of these, and sane defaults are used otherwise. */
export interface Gate2Config {
  /** `durationMs >= minReadableMs(config)` (word-art-event.md). */
  minReadableMs: number;
  /** No two non-STANDARD events closer than this (word-art-plan.md density rule). */
  minSpacingMs: number;
}

export const DEFAULT_GATE2_CONFIG: Gate2Config = {
  minReadableMs: 800,
  minSpacingMs: 4000
};

export interface Gate2ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: string[];
}

function toResult<T>(parsed: z.ZodSafeParseResult<T>): Gate2ValidationResult<T> {
  if (parsed.success) return { valid: true, data: parsed.data, errors: [] };
  const errors = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  return { valid: false, errors };
}

/**
 * Gate 2 validation for a single `WordArtEvent` candidate: schema/shape/range checks plus the
 * timing rule the schema alone can't express (`durationMs >= minReadableMs`).
 */
export function validateWordArtEvent(
  candidate: unknown,
  config: Gate2Config = DEFAULT_GATE2_CONFIG
): Gate2ValidationResult<WordArtEvent> {
  const parsed = WordArtEventSchema.safeParse(candidate);
  const result = toResult<WordArtEvent>(parsed as z.ZodSafeParseResult<WordArtEvent>);
  if (!result.valid) return result;

  const event = result.data as WordArtEvent;
  const errors: string[] = [];
  if (event.durationMs < config.minReadableMs) {
    errors.push(
      `durationMs: ${event.durationMs}ms is below minReadableMs (${config.minReadableMs}ms)`
    );
  }
  if (errors.length > 0) return { valid: false, errors };
  return result;
}

/**
 * Gate 2 validation for a `WordArtPlan`: schema/shape checks, strict time-ordering of the
 * referenced events, and (when the full event objects are supplied) the density rule —
 * no two non-`STANDARD` events closer than `minSpacingMs`.
 *
 * `events` (the resolved `WordArtEvent` objects the plan's `events` ids refer to) is optional:
 * when omitted, only the plan's own shape and id list are checked — per the contract, "every
 * referenced event validates individually" is this function's job once the caller has the
 * actual event objects to hand.
 */
export function validateWordArtPlan(
  candidate: unknown,
  events?: readonly WordArtEvent[],
  config: Gate2Config = DEFAULT_GATE2_CONFIG
): Gate2ValidationResult<WordArtPlan> {
  const parsed = WordArtPlanSchema.safeParse(candidate);
  const result = toResult<WordArtPlan>(parsed as z.ZodSafeParseResult<WordArtPlan>);
  if (!result.valid) return result;

  const plan = result.data as WordArtPlan;
  const errors: string[] = [];

  if (events) {
    const byId = new Map(events.map((e) => [e.id, e]));
    for (const id of plan.events) {
      if (!byId.has(id)) errors.push(`events: no event supplied for referenced id "${id}"`);
    }

    const ordered = plan.events.map((id) => byId.get(id)).filter((e): e is WordArtEvent => !!e);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const curr = ordered[i];
      if (curr.startMs < prev.startMs + prev.durationMs) {
        errors.push(
          `events: "${curr.id}" starts at ${curr.startMs}ms, before "${prev.id}" ends ` +
            `at ${prev.startMs + prev.durationMs}ms (must be strictly time-ordered, non-overlapping)`
        );
      }
    }

    const nonStandard = ordered.filter((e) => e.importance === 'cinematic');
    for (let i = 1; i < nonStandard.length; i++) {
      const gap = nonStandard[i].startMs - (nonStandard[i - 1].startMs + nonStandard[i - 1].durationMs);
      if (gap < config.minSpacingMs) {
        errors.push(
          `density: "${nonStandard[i].id}" is ${gap}ms after "${nonStandard[i - 1].id}", ` +
            `below minSpacingMs (${config.minSpacingMs}ms)`
        );
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return result;
}
