import { describe, it, expect } from 'vitest';
import type { WordArtEvent } from '../src/wordArt.js';
import { validateWordArtEvent, validateWordArtPlan } from '../src/wordArt.validate.js';

// Minimal, valid fixture — one field flexed per test rather than duplicated per-case.
function makeEvent(overrides: Partial<WordArtEvent> = {}): unknown {
  return {
    contractVersion: '1.0.0',
    id: 'wae_1',
    planId: 'wap_1',
    sourceAssetId: 'asset_1',
    sourceTranscriptRef: 'seg_1',
    seq: 0,
    startMs: 0,
    durationMs: 2000,
    phrase: 'Build the system first.',
    tokens: [],
    emphasisTokenIndexes: [],
    rhetoricalRole: 'declaration',
    heroScore: 0.8,
    importance: 'cinematic',
    confidence: 0.75,
    reasonCode: 'HERO_DECLARATION_HIGH_PROSODY',
    primitive: 'ARCHITECT',
    motionProfile: 'CONSTRUCT',
    brandProfile: 'mstr-rahm@2',
    typography: { profileRef: 'mstr-rahm/hero', case: 'upper' },
    composition: { anchor: 'center' },
    animationIntensity: { impact: 0.8 },
    rendererReqs: ['variableFont'],
    state: 'PROPOSED',
    provenance: {},
    ...overrides
  };
}

function makePlan(events: string[] = ['wae_1']): unknown {
  return {
    contractVersion: '1.0.0',
    id: 'wap_1',
    productionId: 'prod_1',
    configVersion: 'score-2026.08.1',
    sourceAssetId: 'asset_1',
    sourceTranscriptRef: 'transcript_1',
    autonomyLevel: 'L1',
    status: 'proposed',
    events,
    density: {
      totalSegments: 10,
      wordArtEvents: events.length,
      byPrimitive: { ARCHITECT: events.length },
      minSpacingMs: 4000,
      violations: []
    },
    provenance: {},
    createdAt: '2026-08-30T00:00:00Z',
    updatedAt: '2026-08-30T00:00:00Z'
  };
}

describe('validateWordArtEvent', () => {
  it('accepts a well-formed event', () => {
    const result = validateWordArtEvent(makeEvent());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a missing required field (phrase)', () => {
    const candidate = makeEvent();
    delete (candidate as Record<string, unknown>).phrase;
    const result = validateWordArtEvent(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.startsWith('phrase'))).toBe(true);
  });

  it('rejects a zero/negative duration', () => {
    const result = validateWordArtEvent(makeEvent({ durationMs: 0 }));
    expect(result.valid).toBe(false);
  });

  it('rejects durationMs below minReadableMs', () => {
    const result = validateWordArtEvent(makeEvent({ durationMs: 100 }), {
      minReadableMs: 800,
      minSpacingMs: 4000
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('minReadableMs'))).toBe(true);
  });

  it('rejects an animationIntensity value outside [0,1]', () => {
    const result = validateWordArtEvent(makeEvent({ animationIntensity: { impact: 1.5 } }));
    expect(result.valid).toBe(false);
  });

  it('rejects heroScore outside [0,1]', () => {
    const result = validateWordArtEvent(makeEvent({ heroScore: 1.2 }));
    expect(result.valid).toBe(false);
  });
});

describe('validateWordArtPlan', () => {
  it('accepts a well-formed plan with no events supplied for cross-check', () => {
    const result = validateWordArtPlan(makePlan());
    expect(result.valid).toBe(true);
  });

  it('rejects a plan with a malformed density summary', () => {
    const plan = makePlan() as Record<string, unknown>;
    (plan.density as Record<string, unknown>).minSpacingMs = -1;
    const result = validateWordArtPlan(plan);
    expect(result.valid).toBe(false);
  });

  it('rejects a referenced event id with no supplied event', () => {
    const result = validateWordArtPlan(makePlan(['wae_missing']), []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('wae_missing'))).toBe(true);
  });

  it('accepts strictly time-ordered, non-overlapping events', () => {
    const e1 = makeEvent({ id: 'wae_1', startMs: 0, durationMs: 2000 }) as WordArtEvent;
    const e2 = makeEvent({ id: 'wae_2', startMs: 6000, durationMs: 2000 }) as WordArtEvent;
    const result = validateWordArtPlan(makePlan(['wae_1', 'wae_2']), [e1, e2]);
    expect(result.valid).toBe(true);
  });

  it('rejects overlapping events', () => {
    const e1 = makeEvent({ id: 'wae_1', startMs: 0, durationMs: 2000 }) as WordArtEvent;
    const e2 = makeEvent({ id: 'wae_2', startMs: 1000, durationMs: 2000 }) as WordArtEvent;
    const result = validateWordArtPlan(makePlan(['wae_1', 'wae_2']), [e1, e2]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('overlapping'))).toBe(true);
  });

  it('rejects two cinematic events closer than minSpacingMs', () => {
    const e1 = makeEvent({ id: 'wae_1', startMs: 0, durationMs: 2000 }) as WordArtEvent;
    const e2 = makeEvent({ id: 'wae_2', startMs: 3000, durationMs: 2000 }) as WordArtEvent;
    const result = validateWordArtPlan(makePlan(['wae_1', 'wae_2']), [e1, e2]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('density'))).toBe(true);
  });
});
