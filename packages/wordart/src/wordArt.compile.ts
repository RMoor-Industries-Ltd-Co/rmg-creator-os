// Word Art — headless exercise path, Sprint 2 PR 3.
//
// Proves, at the package/test level only, the chain:
//   validated WordArtEvent -> WordArtRenderRequest (deterministic compile)
//                          -> synthetic WordArtRenderResult (NullRenderer-shaped, no real render)
//
// This is the Timeline Compiler's job description (render-request.md: "deterministic code
// compiles it from a validated word-art-event... carries computed motion parameters, not the
// raw normalized intensity") done minimally, with no worker/route/DB/renderer-registry
// involvement. Not exported from the main barrel — see package.json's `exports` map — so it
// never reaches the dashboard bundle, same reasoning as PR 2's wordArt.validate fix.
//
// Deliberately NOT a `Renderer` (packages/integrations): that interface's `RenderJob`/
// `RenderResult` are the simpler Sprint 1 PR 4 renderer-boundary shapes; forcing this richer
// domain-level request/result through them would be lossy. See docs/architecture/01-word-art.md.

import { createHash } from 'node:crypto';
import type {
  MotionProfile,
  WordArtBox,
  WordArtComputedMotion,
  WordArtEvent,
  WordArtRenderMode,
  WordArtRenderOutputSpec,
  WordArtRenderRequest,
  WordArtRenderResult,
  WordArtRenderTargetProvider
} from './wordArt.js';

/** Vendor-specific identifiers must never appear in a domain-level render request — this is
 * the render-request.md lint rule ("no vendor-specific identifier permitted in this payload").
 * Kept intentionally narrow (known vendor artifact extensions), not a general string scanner. */
const VENDOR_ARTIFACT_PATTERN = /\.(mogrt|aep|prproj|fcpxml)\b/i;

function assertNoVendorArtifacts(value: unknown, path = 'request'): void {
  if (typeof value === 'string') {
    if (VENDOR_ARTIFACT_PATTERN.test(value)) {
      throw new Error(`compileWordArtRenderRequest: vendor-specific identifier found at ${path}: "${value}"`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoVendorArtifacts(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoVendorArtifacts(v, `${path}.${k}`);
  }
}

/** `motion-profile.md`'s `{ map: "lerp", in: [a,b], out: [c,d] }` curve, clamped to the input
 * domain. Curve representations beyond `lerp` are EXPERIMENTAL per the contract; only `lerp`
 * is implemented here. */
function evaluateCurve(curve: { map: string; in: [number, number]; out: [number, number] }, t: number): number {
  if (curve.map !== 'lerp') {
    throw new Error(`compileWordArtRenderRequest: unsupported motion curve map "${curve.map}" (only "lerp" is implemented)`);
  }
  const [inLo, inHi] = curve.in;
  const [outLo, outHi] = curve.out;
  const clamped = Math.min(Math.max(t, Math.min(inLo, inHi)), Math.max(inLo, inHi));
  const span = inHi - inLo;
  const ratio = span === 0 ? 0 : (clamped - inLo) / span;
  return outLo + ratio * (outHi - outLo);
}

const COMPUTED_MOTION_KEYS: (keyof WordArtComputedMotion)[] = [
  'scalePeak',
  'trackingPeak',
  'blurInitial',
  'overshoot',
  'animationMs'
];

/**
 * Applies a `MotionProfile`'s curves to an event's normalized `animationIntensity`, producing
 * the concrete, reproducible parameters a `WordArtRenderRequest` carries — never the raw
 * intensity (render-request.md's "not the raw normalized intensity" rule). Deterministic:
 * same profile + same intensity input always yields the same numbers (motion-profile.md's
 * reproducibility requirement).
 */
export function computeMotionParameters(event: WordArtEvent, profile: MotionProfile): WordArtComputedMotion {
  const inputKey = profile.intensityInputs[0];
  if (!inputKey) {
    throw new Error(`computeMotionParameters: motion profile "${profile.code}" declares no intensityInputs`);
  }
  const intensity = event.animationIntensity[inputKey];
  if (typeof intensity !== 'number') {
    throw new Error(
      `computeMotionParameters: event "${event.id}" has no animationIntensity value for "${inputKey}" ` +
        `required by motion profile "${profile.code}"`
    );
  }

  const computed: Partial<WordArtComputedMotion> = {};
  for (const key of COMPUTED_MOTION_KEYS) {
    const curve = profile.curves[key];
    if (!curve) {
      throw new Error(`computeMotionParameters: motion profile "${profile.code}" has no curve for "${key}"`);
    }
    computed[key] = evaluateCurve(curve, intensity);
  }
  return computed as WordArtComputedMotion;
}

export interface CompileWordArtRenderRequestOptions {
  targetProvider: WordArtRenderTargetProvider;
  mode: WordArtRenderMode;
  motionProfile: MotionProfile;
  output: WordArtRenderOutputSpec;
  configVersion: string;
  /**
   * The text-box placement rectangle from the event's `CompositionContext` (composition-
   * context.md). NOT derivable from `WordArtEvent.composition` alone — that field only carries
   * `{anchor, safeZone}` (an anchor region name + a safe-zone label), not normalized `[0,1]`
   * coordinates, while `WordArtRenderRequest.composition` needs the actual `textBox` rectangle.
   * Contract ambiguity: `word-art-event.md`'s example nests `composition` directly on the
   * event, but `composition-context.md`'s richer schema (which is where `textBox` actually
   * lives) is never explicitly wired back onto the event by either spec. Until that's
   * resolved, callers must supply the resolved `textBox` explicitly.
   */
  textBox: WordArtBox;
}

/**
 * Deterministically compiles a Gate-2-validated `WordArtEvent` into the renderer-independent
 * `WordArtRenderRequest` a renderer adapter would consume (render-request.md). Callers are
 * expected to have already run the event through Gate 2 (`validateWordArtEvent`) — this
 * function does not re-validate, it compiles.
 */
export function compileWordArtRenderRequest(
  event: WordArtEvent,
  opts: CompileWordArtRenderRequestOptions
): WordArtRenderRequest {
  const request: WordArtRenderRequest = {
    contractVersion: event.contractVersion,
    id: `rr_${event.id}`,
    eventId: event.id,
    capability: 'wordart',
    targetProvider: opts.targetProvider,
    mode: opts.mode,
    primitive: event.primitive,
    motionProfile: event.motionProfile,
    brandProfile: event.brandProfile,
    phrase: event.phrase,
    emphasisTokenIndexes: event.emphasisTokenIndexes,
    typography: event.typography,
    composition: { textBox: opts.textBox },
    timing: { startMs: event.startMs, durationMs: event.durationMs },
    computedMotion: computeMotionParameters(event, opts.motionProfile),
    output: opts.output,
    configVersion: opts.configVersion,
    idempotencyKey: `${event.id}:${opts.targetProvider}:${opts.mode}:${opts.configVersion}`
  };

  assertNoVendorArtifacts(request);
  return request;
}

/**
 * Builds the synthetic `WordArtRenderResult` a NullRenderer-style adapter would return: no
 * pixels, a deterministic descriptor echoing the request, and a checksum derived purely from
 * `(request, configVersion)` — render-result.md's "NullRenderer result" rule, which exists so
 * "Gate 4 logic, provenance, and conformance tests run with no Adobe installed."
 */
export function buildSyntheticWordArtRenderResult(
  request: WordArtRenderRequest,
  configVersion: string
): WordArtRenderResult {
  const checksum =
    'sha256:' +
    createHash('sha256').update(JSON.stringify(request)).update(' ').update(configVersion).digest('hex');

  return {
    contractVersion: request.contractVersion,
    id: `rres_${request.id}`,
    requestId: request.id,
    eventId: request.eventId,
    provider: 'null',
    status: 'done',
    mode: request.mode,
    // Synthetic descriptor echoing the request — no pixels, but the same fields a real asset
    // would carry, so Gate 4/provenance logic can exercise the shape with no Adobe installed
    // (render-result.md's "NullRenderer result" rule: "a synthetic checksum derived from
    // (request, configVersion)"). width/height are a coarse aspect-ratio-derived placeholder,
    // not a real frame size — EXPERIMENTAL, fine for a headless exercise.
    asset: {
      durationMs: request.timing.durationMs,
      width: request.output.aspectRatio === '9:16' ? 1080 : 1920,
      height: request.output.aspectRatio === '9:16' ? 1920 : 1080,
      codec: request.output.codec,
      container: 'mov',
      transparent: request.output.transparent,
      checksum
    },
    primitiveImplementation: `${request.primitive}/synthetic`,
    rendererVersion: 'null/synthetic-1.0.0',
    configVersion,
    warnings: [],
    error: null,
    renderedAt: new Date(0).toISOString() // deterministic — no wall-clock in a synthetic result
  };
}
