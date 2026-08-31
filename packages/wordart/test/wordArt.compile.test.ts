import { describe, it, expect } from 'vitest';
import type { MotionProfile, WordArtEvent } from '../src/wordArt.js';
import {
  buildSyntheticWordArtRenderResult,
  compileWordArtRenderRequest,
  computeMotionParameters,
  type CompileWordArtRenderRequestOptions
} from '../src/wordArt.compile.js';

function makeEvent(overrides: Partial<WordArtEvent> = {}): WordArtEvent {
  return {
    contractVersion: '1.0.0',
    id: 'wae_1',
    planId: 'wap_1',
    sourceAssetId: 'asset_1',
    sourceTranscriptRef: 'seg_1',
    seq: 0,
    startMs: 18420,
    durationMs: 2160,
    phrase: 'Build the system first.',
    tokens: [],
    emphasisTokenIndexes: [1],
    rhetoricalRole: 'declaration',
    heroScore: 0.88,
    importance: 'cinematic',
    confidence: 0.79,
    reasonCode: 'HERO_DECLARATION_HIGH_PROSODY',
    primitive: 'ARCHITECT',
    motionProfile: 'CONSTRUCT',
    brandProfile: 'mstr-rahm@2',
    typography: { profileRef: 'mstr-rahm/hero', case: 'upper' },
    composition: { anchor: 'center', safeZone: 'speaker_aware' },
    animationIntensity: { impact: 0.83 },
    rendererReqs: ['variableFont', 'perCharAnimation'],
    state: 'PROPOSED',
    provenance: {},
    ...overrides
  };
}

const motionProfile: MotionProfile = {
  contractVersion: '1.0.0',
  code: 'CONSTRUCT',
  configVersion: 'motion-2026.08.1',
  intensityInputs: ['impact'],
  curves: {
    scalePeak: { map: 'lerp', in: [0, 1], out: [1.0, 1.6] },
    trackingPeak: { map: 'lerp', in: [0, 1], out: [0.0, 0.05] },
    blurInitial: { map: 'lerp', in: [0, 1], out: [0, 24] },
    overshoot: { map: 'lerp', in: [0, 1], out: [0.0, 0.18] },
    animationMs: { map: 'lerp', in: [0, 1], out: [400, 1200] }
  },
  requires: ['perCharAnimation']
};

const compileOpts: CompileWordArtRenderRequestOptions = {
  targetProvider: 'adobe',
  mode: 'preview',
  motionProfile,
  output: { aspectRatio: '9:16', codec: 'prores4444', transparent: true },
  configVersion: 'motion-2026.08.1',
  textBox: { x: 0.06, y: 0.08, width: 0.5, height: 0.18 }
};

describe('computeMotionParameters', () => {
  it('derives concrete parameters from the profile curves and event intensity', () => {
    const event = makeEvent();
    const computed = computeMotionParameters(event, motionProfile);
    // impact = 0.83 -> lerp(0.83, [0,1], [1.0,1.6]) = 1.0 + 0.83*0.6 = 1.498
    expect(computed.scalePeak).toBeCloseTo(1.498, 6);
    expect(computed.animationMs).toBeCloseTo(1064, 6);
  });

  it('throws when the event has no intensity value the profile requires', () => {
    const event = makeEvent({ animationIntensity: {} });
    expect(() => computeMotionParameters(event, motionProfile)).toThrow(/no animationIntensity value/);
  });
});

describe('compileWordArtRenderRequest', () => {
  it('compiles a complete WordArtRenderRequest from a valid event', () => {
    const request = compileWordArtRenderRequest(makeEvent(), compileOpts);
    expect(request.capability).toBe('wordart');
    expect(request.eventId).toBe('wae_1');
    expect(request.primitive).toBe('ARCHITECT');
    expect(request.motionProfile).toBe('CONSTRUCT');
    expect(request.timing).toEqual({ startMs: 18420, durationMs: 2160 });
    expect(request.computedMotion.scalePeak).toBeCloseTo(1.498, 6);
    expect(request.idempotencyKey).toBe('wae_1:adobe:preview:motion-2026.08.1');
  });

  it('never includes a vendor-specific artifact identifier', () => {
    expect(() =>
      compileWordArtRenderRequest(makeEvent({ phrase: 'reference project.mogrt' }), compileOpts)
    ).toThrow(/vendor-specific identifier/);
  });

  it('produces byte-identical requests for the same input', () => {
    const a = compileWordArtRenderRequest(makeEvent(), compileOpts);
    const b = compileWordArtRenderRequest(makeEvent(), compileOpts);
    expect(a).toEqual(b);
  });

  it('produces a stable idempotencyKey for the same inputs', () => {
    const a = compileWordArtRenderRequest(makeEvent(), compileOpts);
    const b = compileWordArtRenderRequest(makeEvent(), compileOpts);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });
});

describe('buildSyntheticWordArtRenderResult', () => {
  it('produces a stable checksum for the same (request, configVersion)', () => {
    const request = compileWordArtRenderRequest(makeEvent(), compileOpts);
    const r1 = buildSyntheticWordArtRenderResult(request, 'motion-2026.08.1');
    const r2 = buildSyntheticWordArtRenderResult(request, 'motion-2026.08.1');
    expect(r1.rendererVersion).toEqual(r2.rendererVersion);
    expect(r1).toEqual(r2);
  });

  it('changes when configVersion changes', () => {
    const request = compileWordArtRenderRequest(makeEvent(), compileOpts);
    const r1 = buildSyntheticWordArtRenderResult(request, 'motion-2026.08.1');
    const r2 = buildSyntheticWordArtRenderResult(request, 'motion-2026.09.1');
    expect(r1).not.toEqual(r2);
  });

  it('is provider "null", status "done", with a synthetic (no-pixels) asset descriptor', () => {
    const request = compileWordArtRenderRequest(makeEvent(), compileOpts);
    const result = buildSyntheticWordArtRenderResult(request, 'motion-2026.08.1');
    expect(result.provider).toBe('null');
    expect(result.status).toBe('done');
    expect(result.asset?.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
