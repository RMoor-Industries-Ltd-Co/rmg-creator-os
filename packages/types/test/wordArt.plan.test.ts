import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MotionProfile } from '../src/wordArt.js';
import {
  buildWordArtPlanFromSegments,
  scoreSegment,
  type TranscriptSegment,
  type WordArtPlanBuilderConfig
} from '../src/wordArt.plan.js';
import { validateWordArtEvent, validateWordArtPlan } from '../src/wordArt.validate.js';
import { buildSyntheticWordArtRenderResult, compileWordArtRenderRequest } from '../src/wordArt.compile.js';

function loadFixture(name: string): TranscriptSegment[] {
  const path = fileURLToPath(new URL(`./fixtures/word-art/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as TranscriptSegment[];
}

const config: WordArtPlanBuilderConfig = {
  configVersion: 'score-2026.08.1',
  productionId: 'prod_fixture_1',
  sourceAssetId: 'asset_fixture_1',
  sourceTranscriptRef: 'transcript_fixture_1',
  autonomyLevel: 'L0',
  heroScoreThreshold: 0.7,
  minReadableMs: 800,
  minSpacingMs: 3500,
  emphasisKeywords: ['build', 'never', 'always'],
  defaultPrimitive: 'ARCHITECT',
  defaultMotionProfile: 'CONSTRUCT',
  defaultBrandProfile: 'mstr-rahm@2',
  defaultTypographyProfileRef: 'mstr-rahm/hero',
  defaultAnchor: 'center'
};

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

describe('scoreSegment', () => {
  it('scores a short, keyword-bearing, exclaimed segment highly', () => {
    const score = scoreSegment(
      { id: 's', text: 'Build the system first!', startMs: 0, durationMs: 2000 },
      config
    );
    expect(score).toBeGreaterThanOrEqual(config.heroScoreThreshold);
  });

  it('scores a long, keyword-free segment low', () => {
    const score = scoreSegment(
      {
        id: 's',
        text: 'This week we are going to walk through the quarterly numbers together.',
        startMs: 0,
        durationMs: 5000
      },
      config
    );
    expect(score).toBeLessThan(config.heroScoreThreshold);
  });
});

describe('buildWordArtPlanFromSegments — full fixture-transcript-to-validated-plan path', () => {
  it('declaration fixture: produces a plan with at least one Word Art event, validates, compiles, and yields a synthetic result', () => {
    const segments = loadFixture('declaration-segments');
    const { plan, events } = buildWordArtPlanFromSegments(segments, config);

    expect(plan.density.totalSegments).toBe(segments.length);
    expect(events.length).toBeGreaterThan(0);
    expect(plan.events).toEqual(events.map((e) => e.id));

    for (const event of events) {
      const eventResult = validateWordArtEvent(event, {
        minReadableMs: config.minReadableMs,
        minSpacingMs: config.minSpacingMs
      });
      expect(eventResult.valid).toBe(true);
    }

    const planResult = validateWordArtPlan(plan, events, {
      minReadableMs: config.minReadableMs,
      minSpacingMs: config.minSpacingMs
    });
    expect(planResult.valid).toBe(true);

    const [firstEvent] = events;
    const request = compileWordArtRenderRequest(firstEvent, {
      targetProvider: 'null',
      mode: 'preview',
      motionProfile,
      output: { aspectRatio: '9:16', codec: 'prores4444', transparent: true },
      configVersion: motionProfile.configVersion,
      textBox: { x: 0.06, y: 0.08, width: 0.5, height: 0.18 }
    });
    expect(request.eventId).toBe(firstEvent.id);

    const result = buildSyntheticWordArtRenderResult(request, motionProfile.configVersion);
    expect(result.status).toBe('done');
    expect(result.provider).toBe('null');
  });

  it('standard-caption fixture: produces zero Word Art events (correctly not cinematic)', () => {
    const segments = loadFixture('standard-caption-segments');
    const { plan, events } = buildWordArtPlanFromSegments(segments, config);

    expect(events).toHaveLength(0);
    expect(plan.density.wordArtEvents).toBe(0);
    expect(plan.density.totalSegments).toBe(segments.length);
    expect(plan.events).toEqual([]);

    // An empty-events plan still validates on its own shape.
    const planResult = validateWordArtPlan(plan);
    expect(planResult.valid).toBe(true);
  });

  it('low-confidence fixture: a keyword-bearing but long/unexclaimed segment stays below threshold', () => {
    const segments = loadFixture('low-confidence-segments');
    const { events } = buildWordArtPlanFromSegments(segments, config);
    expect(events).toHaveLength(0);
  });
});
