// Word Art domain types — types-only transcription of the child contract specs in
// rmg-piaar-system's `contracts/word-art/`. See `../../../docs/architecture/01-word-art.md`
// and `contracts/29-word-art.md` for the full architecture and rationale.
//
// Scope (Sprint 2 PR 1): domain interfaces only. No runtime validation, no fixtures, no
// routes, no DB migrations, no renderer/registry/dispatch wiring. Each contract's own
// DECIDED / PROVISIONAL / EXPERIMENTAL / OPEN tags are preserved as inline comments — they
// are not enforced by the type system here.
//
// Open string-code fields (e.g. `primitive`, `motionProfile`, `rhetoricalRole`) are typed as
// `string` rather than closed literal unions: the contracts explicitly require these to stay
// allow-list-extensible via config, not fixed at the type level.

import type { BrandKey, StoreKey } from '@rmg-creator-os/types';

/** Normalized `[0,1]` rectangle, origin top-left (word-art-plan/composition-context convention). */
export interface WordArtBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- word-art-event ----------------------------------------------------------

export type WordArtImportance = 'standard' | 'cinematic'; // derived from heroScore vs thresholds

/** Master state machine value on a `WordArtEvent`. PROVISIONAL — full enum owned by contract 29. */
export type WordArtEventState = string;

export interface WordArtToken {
  text: string;
  semanticWeight: number;
  prosodyWeight: number;
  role: string; // e.g. "hero" — PROVISIONAL vocabulary
}

export interface WordArtAlternative {
  primitive: string;
  confidence: number;
}

/** One typography moment on the timeline. Proposed interface name per word-art-event.md. */
export interface WordArtEvent {
  contractVersion: string;
  id: string;
  planId: string;
  sourceAssetId: string; // DECIDED — provenance to the source video
  sourceTranscriptRef: string; // DECIDED — segment this came from
  seq: number; // DECIDED — order within the plan
  startMs: number; // DECIDED — integer ms
  durationMs: number; // DECIDED — end derivable; >= minReadableMs (Gate 2)
  phrase: string;
  tokens: WordArtToken[];
  emphasisTokenIndexes: number[]; // DECIDED
  rhetoricalRole: string; // PROVISIONAL — open code
  heroScore: number; // PROVISIONAL — from the scoring config
  importance: WordArtImportance;
  confidence: number; // DECIDED — AI confidence
  reasonCode: string; // DECIDED — machine code, not prose
  primitive: string; // open code, allow-list validated
  motionProfile: string; // open code, allow-list validated
  brandProfile: string; // BrandKey + brand-profile version, e.g. "mstr-rahm@2"
  typography: { profileRef: string; case?: TypographyCase };
  composition: { anchor: string; safeZone?: string };
  animationIntensity: Record<string, number>; // DECIDED — normalized [0,1]; NOT keyframes
  rendererReqs: string[];
  alternatives?: WordArtAlternative[]; // PROVISIONAL
  state: WordArtEventState; // DECIDED — master state machine
  provenance: WordArtProvenance;
  validation?: { status: string };
  qa?: { status: string };
}

/** Common provenance shape referenced across the Word Art artifacts. Fields per each spec's
 * own "Provenance" section; kept permissive (all optional beyond the identifying ones) since
 * exact shape is not itself frozen by the contracts. */
export interface WordArtProvenance {
  sourceAssetId?: string;
  sourceTranscriptRef?: string;
  provider?: string;
  model?: string;
  configVersion?: string;
  confidence?: number;
  approvedBy?: string;
  contractVersion?: string;
  brandProfileVersion?: string;
  primitiveImplementation?: string;
  renderer?: string;
  rendererVersion?: string;
}

// --- word-art-plan -------------------------------------------------------------

export type WordArtPlanStatus =
  | 'none'
  | 'analyzing'
  | 'proposed'
  | 'validated'
  | 'rendering'
  | 'complete'
  | 'failed';

export interface WordArtDensitySummary {
  totalSegments: number;
  wordArtEvents: number;
  byPrimitive: Record<string, number>;
  minSpacingMs: number; // PROVISIONAL — enforced minimum gap
  violations: string[];
}

/** The production-level ordered set of events. Proposed interface name per word-art-plan.md. */
export interface WordArtPlan {
  contractVersion: string;
  id: string;
  productionId: string;
  configVersion: string; // DECIDED — which scoring/threshold config scored this
  sourceAssetId: string;
  sourceTranscriptRef: string;
  autonomyLevel: string; // DECIDED — evaluated per event at the gates
  status: WordArtPlanStatus;
  events: string[]; // ordered WordArtEvent ids
  density: WordArtDensitySummary;
  provenance: WordArtProvenance;
  createdAt: string;
  updatedAt: string;
}

// --- typography-profile ---------------------------------------------------------

export type TypographyCase = 'upper' | 'lower' | 'title' | 'as-written';

/** A named, reusable type-intent bundle owned by a brand profile. */
export interface TypographyProfile {
  contractVersion: string;
  ref: string; // e.g. "mstr-rahm/hero"
  brandKey: BrandKey; // DECIDED — references contract-12 BrandKey
  version: number;
  families: string[]; // DECIDED — approved families only
  variableAxes: Record<string, [number, number]>; // permitted ranges, e.g. { wght: [400, 900] }
  defaultWeight: number;
  case: TypographyCase;
  trackingRange: [number, number]; // em; deterministic clamps to this
  hierarchy: string[];
  prohibited: string[]; // DECIDED — brand veto list
}

// --- motion-profile --------------------------------------------------------------

/** f(intensity) -> parameter curve. `map` kind is open (PROVISIONAL — may grow beyond "lerp"). */
export interface WordArtMotionCurve {
  map: string; // e.g. "lerp" — EXPERIMENTAL: curve representation may extend
  in: [number, number];
  out: [number, number];
}

/** How type moves; the deterministic intensity->parameter mapping. */
export interface MotionProfile {
  contractVersion: string;
  code: string; // open code, allow-list validated
  configVersion: string;
  intensityInputs: string[]; // normalized [0,1] inputs it consumes, e.g. ["impact"]
  curves: Record<string, WordArtMotionCurve>; // PROVISIONAL
  requires: string[]; // renderer capabilities this profile needs
}

// --- brand-profile (Word Art) ------------------------------------------------------

/** Word Art's versioned brand rules. Extends contract 12's brand model — does not replace
 * `BrandProfile` (see `./index.js`), and is named distinctly to avoid collision with it. */
export interface WordArtBrandProfile {
  contractVersion: string;
  ref: string; // e.g. "mstr-rahm@2"
  brandKey: BrandKey | StoreKey; // DECIDED — a real BrandKey/StoreKey from contract 12; HVN/AMG scope OPEN
  version: number;
  typographyProfiles: string[]; // TypographyProfile refs
  palette: { permitted: string[]; accent: string[] }; // DECIDED — closed set
  texture?: string;
  stroke: { allowed: boolean };
  shadow: { allowed: boolean; max?: string };
  glow: { allowed: boolean };
  capitalizationDefault: TypographyCase;
  logoMark?: { asset: string; placement: string[]; safeZoneClearMs: number };
  spacing: { marginPct: number };
  safeZoneBehavior: string;
  motionIntensityCeiling: number; // DECIDED — caps any event's intensity for this brand
  prohibited: string[]; // DECIDED — hard veto
}

// --- composition-context ----------------------------------------------------------

export interface WordArtCompositionPlatformAdaptation {
  aspectRatio: string;
  anchor: string;
}

/** Frame-aware placement for an event. All coordinates normalized [0,1], origin top-left. */
export interface CompositionContext {
  contractVersion: string;
  anchor: string; // region or normalized point
  reason: string; // reasonCode, not prose
  textBox: WordArtBox & { maxLines?: number };
  subjectExclusionZone?: WordArtBox;
  faceExclusionZones: WordArtBox[];
  handActionExclusionZones: WordArtBox[];
  lowerThirdRestricted: boolean;
  platformSafeZones: string[]; // named safe-zone sets, e.g. ["tiktok", "reels"]
  negativeSpaceRegions: (WordArtBox & { score?: number })[];
  sceneComplexity: number; // [0,1] — higher = busier frame
  readabilityScore: number; // [0,1] — contrast/legibility of text vs bg
  orientation: string;
  aspectRatio: string;
  cropTarget: string;
  multiPlatform: WordArtCompositionPlatformAdaptation[]; // OPEN — Phase 4 adaptation depth
}

// --- visual-analysis -----------------------------------------------------------

export interface WordArtSubject {
  kind: string;
  box: WordArtBox;
}

/** Multimodal read of the source frame(s); evidence, never the executable spec. */
export interface VisualAnalysis {
  contractVersion: string;
  sourceAssetId: string;
  frameRef: { atMs: number };
  provider: string; // DECIDED — provenance
  model: string;
  confidence: number;
  subjects: WordArtSubject[];
  faces: WordArtBox[];
  hands: WordArtBox[];
  negativeSpace: (WordArtBox & { score: number })[];
  sceneComplexity: number; // [0,1]
  dominantColors: string[];
  backgroundLuma: number; // informs text contrast / readability
  notes?: string; // reasonCode-style tags, not prose
}

// --- render-request (word-art domain level) ----------------------------------------
//
// Distinct from `packages/integrations`'s simpler `RenderJob`/`RenderResult` (Sprint 1 PR 4) —
// named `WordArtRenderRequest`/`WordArtRenderResult` to avoid workspace-wide ambiguity between
// the two, much richer, domain-level shapes and the existing renderer-boundary types.

export type WordArtRenderTargetProvider = 'adobe' | 'resolve' | 'null';
export type WordArtRenderMode = 'preview' | 'production'; // Gate 3 vs Gate 4 path

export interface WordArtComputedMotion {
  scalePeak: number;
  trackingPeak: number;
  blurInitial: number;
  overshoot: number;
  animationMs: number;
}

export interface WordArtRenderOutputSpec {
  aspectRatio: string;
  codec: string;
  transparent: boolean;
}

/** The renderer-independent instruction handed to a renderer adapter for one event. */
export interface WordArtRenderRequest {
  contractVersion: string;
  id: string;
  eventId: string;
  capability: 'wordart'; // DECIDED — repo (capability, provider) dispatch; not registered anywhere yet
  targetProvider: WordArtRenderTargetProvider;
  mode: WordArtRenderMode;
  primitive: string; // DECIDED — domain intent, NOT a vendor template id
  motionProfile: string;
  brandProfile: string;
  phrase: string;
  emphasisTokenIndexes: number[];
  typography: { profileRef: string; case?: TypographyCase };
  composition: { textBox: WordArtBox };
  timing: { startMs: number; durationMs: number };
  computedMotion: WordArtComputedMotion; // DECIDED — deterministic output of motion curves
  output: WordArtRenderOutputSpec; // PROVISIONAL codec/mode matrix per renderer
  configVersion: string; // reproducibility
  idempotencyKey: string; // DECIDED — safe re-enqueue
}

// --- render-result (word-art domain level) ------------------------------------------

export type WordArtRenderResultStatus = 'done' | 'failed';

export interface WordArtRenderedAsset {
  driveFileId?: string; // DECIDED — lands via asset-lifecycle (contract 11)
  driveLink?: string;
  durationMs: number;
  width: number;
  height: number;
  codec: string;
  container: string;
  transparent: boolean;
  checksum: string; // DECIDED — integrity / reproducibility; synthetic for NullRenderer
}

/** What a renderer adapter returns for a `WordArtRenderRequest`. Never trusted blind — Gate 4
 * validates it. */
export interface WordArtRenderResult {
  contractVersion: string;
  id: string;
  requestId: string;
  eventId: string;
  provider: WordArtRenderTargetProvider;
  status: WordArtRenderResultStatus;
  mode: WordArtRenderMode;
  asset?: WordArtRenderedAsset; // absent/synthetic for NullRenderer
  primitiveImplementation: string; // DECIDED — which impl the adapter chose
  rendererVersion: string; // DECIDED — provenance
  configVersion: string;
  warnings: string[];
  error: string | null;
  renderedAt: string;
}

// --- qa-result -------------------------------------------------------------------

export type WordArtQaCheckKind = 'deterministic' | 'ai';
export type WordArtQaVerdict = 'passed' | 'revision_required' | 'failed';
export type WordArtQaDisposition = 'approve' | 'regenerate' | 'edit' | 'reject';

export interface WordArtQaCheck {
  code: string; // from the config allow-list — PROVISIONAL catalog
  kind: WordArtQaCheckKind;
  pass: boolean;
  score?: number;
  confidence?: number;
  reasonCode?: string;
}

/** The Gate 3 (preview validation) verdict. */
export interface QaResult {
  contractVersion: string;
  id: string;
  eventId: string;
  renderResultId: string;
  checks: WordArtQaCheck[];
  verdict: WordArtQaVerdict;
  disposition: WordArtQaDisposition;
  decidedBy: string; // human id or "auto:<level>"
  provider?: string; // for AI checks (provenance)
  model?: string;
  decidedAt: string;
}

// --- approval-decision -----------------------------------------------------------

export type WordArtApprovalScope = 'event' | 'plan';
export type WordArtApprovalGate = 'gate1_creative' | 'gate3_preview';
export type WordArtApprovalDecisionValue = 'approved' | 'rejected' | 'revision_required';

/** A uniform record of every approval — creative (Gate 1) or preview (Gate 3), human or auto. */
export interface ApprovalDecision {
  contractVersion: string;
  id: string;
  scope: WordArtApprovalScope;
  targetId: string; // event or plan id
  gate: WordArtApprovalGate;
  decision: WordArtApprovalDecisionValue;
  decidedBy: string; // human id OR "auto:L<n>"
  autonomyLevel: string; // the level in force at decision time
  confidenceAtDecision?: number; // AI confidence that justified an auto-bypass
  reasonCode: string; // or a human-selected code; not free prose
  note?: string | null; // optional short human note (audit only)
  contractVersionApproved: string; // which event/plan contract version was approved
  decidedAt: string;
}
