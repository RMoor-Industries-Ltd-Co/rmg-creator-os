// Shared domain types for RMG Creator OS.
// These mirror the feature contracts in docs/contracts and are the common
// vocabulary every service speaks.

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  checks: Record<string, 'ok' | 'fail'>;
  time: string;
}

// --- Brand & capability model -------------------------------------------------
// Source of truth: ClickUp "RMG - CREATOR SPACE" + the brand definitions.
// RMG (Renaissance Masters Group) is the master brand; the rest are microbrands.
// PIAAR is the proprietary-software sector (builds RMG Creator OS itself) — it has
// no social channels and no content folder, so it is NOT a BrandKey.

export type BrandKey =
  | 'rmg' // master brand (newsletter only)
  | 'mstr-rahm'
  | 'com'
  | 'busy-mf'
  | 'orr' // a.k.a. R+R — Our Royal Reservations
  | 'vlog'
  | 'trc' // The Rahm Council
  | 'tgl'; // a.k.a. TAL — The Afterlife (Godfather) Lounge

/** Channels a brand can operate. */
export type Channel = 'social' | 'store' | 'newsletter' | 'books';

export interface BrandProfile {
  key: BrandKey;
  /** Display/folder code, e.g. MSTR_RAHM. */
  code: string;
  name: string;
  channels: Channel[];
  /** Content brands get a Drive SCHEDULED/ARCHIVE folder + ClickUp creator folder. */
  contentFolder: boolean;
  /** Author pen name used for the `books` channel, if any. */
  penName?: string;
}

/** Books sell on Amazon (Kindle / KDP). Newsletter platform is not yet settled. */
export const BOOK_PLATFORM = 'Amazon (Kindle / KDP)' as const;
export const NEWSLETTER_PLATFORM: string | null = null; // TBD

export const BRANDS: BrandProfile[] = [
  { key: 'rmg', code: 'RMG', name: 'Renaissance Masters Group', channels: ['newsletter', 'books'], contentFolder: false, penName: 'Brother Bull' },
  { key: 'mstr-rahm', code: 'MSTR_RAHM', name: 'Master Rahm', channels: ['social', 'store'], contentFolder: true },
  { key: 'com', code: 'COM', name: 'Conversations of Mastery', channels: ['social', 'newsletter', 'books'], contentFolder: true },
  { key: 'busy-mf', code: 'BU$Y_MF', name: 'Business Monday thru Friday', channels: ['social'], contentFolder: true },
  { key: 'orr', code: 'ORR', name: 'Our Royal Reservations (R+R)', channels: ['social', 'store', 'newsletter'], contentFolder: true },
  { key: 'vlog', code: 'VLOG', name: 'Virtual Legacy of Greatness', channels: ['social', 'store', 'newsletter', 'books'], contentFolder: true },
  { key: 'trc', code: 'TRC', name: 'The Rahm Council', channels: ['social'], contentFolder: true },
  { key: 'tgl', code: 'TGL', name: 'The Afterlife (Godfather) Lounge', channels: ['social'], contentFolder: true }
];

export const BRAND_KEYS: BrandKey[] = BRANDS.map((b) => b.key);

/** Content brands that produce social assets (have Drive content folders). */
export const CONTENT_BRANDS: BrandKey[] = BRANDS.filter((b) => b.contentFolder).map((b) => b.key);

/** Shopify stores (My Poster owns product photos / descriptions / tags / pricing). */
export type StoreKey = 'hvn' | 'orr' | 'mstr-rahm' | 'vlog';
export const STORE_KEYS: StoreKey[] = ['hvn', 'orr', 'mstr-rahm', 'vlog'];

/** BU$Y_MF (TikTok) is the promo engine that drives traffic to these stores. */
export const BUSY_MF_PROMOTES: StoreKey[] = ['orr', 'mstr-rahm', 'vlog'];

/** PIAAR — proprietary software sector. GitHub only, no social, may add a flagship later. */
export const PIAAR = {
  code: 'PIAAR',
  name: 'PIAAR — proprietary software sector (builds RMG Creator OS)'
} as const;

// --- Pipeline / orchestration -------------------------------------------------

/** The minimal high-value inputs the suite accepts. */
export type InputKind = 'image' | 'video' | 'music' | 'transcript' | 'topic';

/** What a finished creative ships as. */
export type OutputKind = 'content' | 'ad' | 'post' | 'newsletter' | 'book';

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

export const SERVICE_IDS: ServiceId[] = [
  'story-director',
  'social-manager',
  'allen',
  'allie',
  'my-poster'
];
