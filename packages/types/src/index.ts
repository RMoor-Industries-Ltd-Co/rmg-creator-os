// Shared domain types for RMG Creator OS.
// These mirror the feature contracts in docs/contracts and are the common
// vocabulary every service speaks.

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  checks: Record<string, 'ok' | 'fail'>;
  time: string;
}

/** Brand voices. */
export type BrandKey =
  | 'vlog'
  | 'com'
  | 'the-rahm-council'
  | 'royal-reservations'
  | 'busy-mf';

/** Shopify store / ad targets. */
export type StoreKey = 'hvn' | 'rr' | 'busy-mf';

/** The minimal high-value inputs the suite accepts. */
export type InputKind = 'image' | 'video' | 'music' | 'transcript' | 'topic';

/** What a finished creative ships as. */
export type OutputKind = 'content' | 'ad' | 'post';

/** Services that can handle a Recipe step. */
export type ServiceId =
  | 'story-director'
  | 'social-manager'
  | 'allen'
  | 'allie'
  | 'my-poster';

/** A single step in a Recipe, handled by one service. */
export interface RecipeStep {
  id: string;
  service: ServiceId;
  action: string;
  /** ids of steps that must complete before this one runs */
  dependsOn?: string[];
}

/** A reusable pipeline definition: input -> steps -> output. */
export interface Recipe {
  id: string;
  name: string;
  description?: string;
  inputKinds: InputKind[];
  outputKind: OutputKind;
  steps: RecipeStep[];
  createdAt: string;
  updatedAt: string;
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobInput {
  kind: InputKind;
  /** reference to the input: a Drive file id, a topic string, etc. */
  ref: string;
}

/** A single run of a Recipe — the unit the orchestrator tracks. */
export interface Job {
  id: string;
  recipeId: string;
  brand: BrandKey;
  status: JobStatus;
  input: JobInput;
  createdAt: string;
  updatedAt: string;
}

export const BRAND_KEYS: BrandKey[] = [
  'vlog',
  'com',
  'the-rahm-council',
  'royal-reservations',
  'busy-mf'
];

export const SERVICE_IDS: ServiceId[] = [
  'story-director',
  'social-manager',
  'allen',
  'allie',
  'my-poster'
];
