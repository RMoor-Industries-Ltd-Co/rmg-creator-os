import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { foldAnnotationScore, type SegmentSemanticAnnotation } from '../src/wordArt.annotate.js';
import { buildWordArtPlanFromSegments, type WordArtPlanBuilderConfig, type TranscriptSegment } from '../src/wordArt.plan.js';
import { validateWordArtEvent } from '../src/wordArt.validate.js';

function loadAnnotationFixture(name: string): SegmentSemanticAnnotation {
  const path = fileURLToPath(new URL(`./fixtures/word-art/annotations/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as SegmentSemanticAnnotation;
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
  defaultAnchor: 'center',
  minAnnotationConfidence: 0.5,
  annotationWeight: 0.6
};

function makeAnnotation(overrides: Partial<SegmentSemanticAnnotation> = {}): SegmentSemanticAnnotation {
  return {
    contractVersion: '1.0.0',
    segmentId: 'seg_1',
    heroScoreHint: 0.9,
    confidence: 0.8,
    reasonCode: 'HIGH_RHETORICAL_SIGNIFICANCE',
    provider: 'allen',
    model: 'test-model',
    ...overrides
  };
}

describe('foldAnnotationScore', () => {
  it('returns the heuristic score unchanged when no annotation is supplied', () => {
    expect(foldAnnotationScore(0.4, undefined, config)).toBe(0.4);
  });

  it('ignores an annotation below the confidence floor — heuristic decides alone', () => {
    const annotation = makeAnnotation({ heroScoreHint: 0.99, confidence: 0.1 });
    expect(foldAnnotationScore(0.2, annotation, config)).toBe(0.2);
  });

  it('blends a confident annotation with the heuristic score', () => {
    const annotation = makeAnnotation({ heroScoreHint: 1.0, confidence: 0.9 });
    // weight 0.6: 0.6*1.0 + 0.4*0.2 = 0.68
    expect(foldAnnotationScore(0.2, annotation, config)).toBeCloseTo(0.68, 6);
  });

  it('clamps the blended result to [0,1]', () => {
    const annotation = makeAnnotation({ heroScoreHint: 5, confidence: 1 });
    expect(foldAnnotationScore(5, annotation, config)).toBe(1);
  });
});

describe('buildWordArtPlanFromSegments with annotations — AI is evidence, not a decision', () => {
  const lowHeuristicSegment: TranscriptSegment = {
    id: 'seg_low_heuristic',
    text: 'This week we are going to walk through the quarterly numbers together.',
    startMs: 0,
    durationMs: 5000
  };

  // A higher annotationWeight than foldAnnotationScore's own unit tests above, so a
  // maximally-confident, maximally-scored annotation (blend = weight * 1.0 + (1-weight) * 0)
  // can actually clear heroScoreThreshold (0.7) on a segment whose heuristic score is 0 —
  // proving the annotation can *contribute* to the outcome without proving it can bypass the
  // threshold itself (still gated identically either way).
  const planConfig: WordArtPlanBuilderConfig = { ...config, annotationWeight: 0.8 };

  it('a high-confidence (fixture) annotation can push a low-heuristic segment into an event only once the blended score clears the threshold', () => {
    const annotation = loadAnnotationFixture('high-confidence-declaration');
    const { events } = buildWordArtPlanFromSegments(
      [lowHeuristicSegment],
      planConfig,
      { [annotation.segmentId]: annotation }
    );
    expect(events).toHaveLength(1);
    expect(events[0].reasonCode).toBe('HERO_AI_ANNOTATION_BLENDED');
    expect(events[0].provenance.provider).toBe('allen');
  });

  it('a low-confidence annotation does not rescue a low-heuristic segment (ignored, not blended)', () => {
    const annotation = makeAnnotation({
      segmentId: 'seg_low_heuristic',
      heroScoreHint: 1.0,
      confidence: 0.2 // below minAnnotationConfidence
    });
    const { events } = buildWordArtPlanFromSegments(
      [lowHeuristicSegment],
      config,
      { [annotation.segmentId]: annotation }
    );
    expect(events).toHaveLength(0);
  });

  it('AI confidence does not bypass Gate-2 validation: a confidently-annotated but too-short event still fails Gate 2', () => {
    const tooShort: TranscriptSegment = {
      id: 'seg_too_short',
      text: 'Build the system first!',
      startMs: 0,
      durationMs: 100 // below config.minReadableMs (800)
    };
    const annotation = makeAnnotation({ segmentId: 'seg_too_short', heroScoreHint: 1.0, confidence: 1.0 });
    const { events } = buildWordArtPlanFromSegments([tooShort], config, { [annotation.segmentId]: annotation });

    expect(events).toHaveLength(1); // the plan builder itself has no duration gate — Gate 2 does
    const result = validateWordArtEvent(events[0], {
      minReadableMs: config.minReadableMs,
      minSpacingMs: config.minSpacingMs
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('minReadableMs'))).toBe(true);
  });

  it('primitive and motion profile selection remain deterministic regardless of annotation content', () => {
    const annotation = makeAnnotation({
      segmentId: 'seg_low_heuristic',
      heroScoreHint: 1.0,
      confidence: 1.0,
      // an annotation cannot request a different primitive/motionProfile — the shape has no
      // such field at all; this test documents that fact rather than exercising a rejection.
    });
    const { events } = buildWordArtPlanFromSegments(
      [lowHeuristicSegment],
      planConfig,
      { [annotation.segmentId]: annotation }
    );
    expect(events[0].primitive).toBe(config.defaultPrimitive);
    expect(events[0].motionProfile).toBe(config.defaultMotionProfile);
  });

  it('a malformed annotation (missing segmentId match) is simply not applied — no crash, no silent normalization into a false event', () => {
    const annotation = makeAnnotation({ segmentId: 'seg_does_not_exist', heroScoreHint: 1.0, confidence: 1.0 });
    const { events } = buildWordArtPlanFromSegments(
      [lowHeuristicSegment],
      config,
      { [annotation.segmentId]: annotation }
    );
    expect(events).toHaveLength(0); // annotation never matched lowHeuristicSegment.id, so it's inert
  });

  it('omitting annotations entirely is identical to the pre-Sprint-4 pure-heuristic behavior', () => {
    const withoutAnnotations = buildWordArtPlanFromSegments([lowHeuristicSegment], config);
    expect(withoutAnnotations.events).toHaveLength(0);
  });
});
