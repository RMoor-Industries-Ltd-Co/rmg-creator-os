import { pgTable, text, timestamp, jsonb, pgEnum, real, boolean, uuid, integer, bigint } from 'drizzle-orm/pg-core';
import type { InputKind, JobInput, OutputKind, RecipeStep } from '@rmg-creator-os/types';

export const adIndexStatusEnum = pgEnum('ad_index_status', ['draft', 'approved', 'published', 'archived']);

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled'
]);

/** Reusable pipeline definitions: input -> steps -> output. */
export const recipes = pgTable('recipes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  inputKinds: jsonb('input_kinds').$type<InputKind[]>().notNull(),
  outputKind: text('output_kind').$type<OutputKind>().notNull(),
  steps: jsonb('steps').$type<RecipeStep[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

/** A content production — the wizard operates on one of these (starts at the Script stage). */
export const productions = pgTable('productions', {
  id: text('id').primaryKey(),
  brand: text('brand').notNull(),
  persona: text('persona'),
  outputKind: text('output_kind').notNull().default('post'),
  topic: text('topic').notNull(),
  context: text('context'),
  title: text('title'),
  scriptText: text('script_text'),
  scriptDocId: text('script_doc_id'),
  scriptDocUrl: text('script_doc_url'),
  scriptStatus: text('script_status').notNull().default('draft'),
  model: text('model'),
  // Voice Direction (Emotion Director) — set on the wizard's Voice step.
  voiceBrand: text('voice_brand'), // brand whose inflection/energy was applied
  taggedScript: text('tagged_script'), // script annotated with eleven_v3 (bracket tags + caps)
  taggedScriptV2: text('tagged_script_v2'), // script annotated for eleven v2 (caps + punctuation only)
  stabilityMode: text('stability_mode'), // creative | natural | robust
  stability: real('stability'), // 0.0 / 0.5 / 1.0
  audioTagPalette: text('audio_tag_palette'),
  intensity: text('intensity'),
  voiceId: text('voice_id'), // resolved ElevenLabs voice for the speaker
  // Persistent voice takes — one asset slot per version, overwritten (pointer swap) on
  // regenerate. References assets.id; the underlying Drive file/asset row from a prior
  // take is left in place (not deleted), only the pointer moves.
  voiceTakeAssetIdV2: text('voice_take_asset_id_v2'),
  voiceTakeAssetIdV3: text('voice_take_asset_id_v3'),
  emotionLocked: boolean('emotion_locked').notNull().default(false),
  stage: text('stage').notNull().default('script'),
  status: text('status').notNull().default('active'),
  // Delivery fields (contracts 18, 19)
  adIndexCode: text('ad_index_code'),
  finalVideoId: text('final_video_id'),
  /** The APPROVED CANONICAL render (migration 0024, ratified decision D-I) — not the first
   *  successful provider output and not the newest row by `updatedAt`. `text`, matching
   *  `videos.id`. Distinct from `finalVideoId`, which holds a Drive file id from one
   *  producer and is never set by the other; that inconsistency is why this exists.
   *  Unpopulated until the candidate/canonical model lands. */
  finalVideoRowId: text('final_video_row_id'),
  thumbnailDriveId: text('thumbnail_drive_id'),
  brollScenes: jsonb('broll_scenes').$type<Record<string, unknown>[]>().default([]),
  brollLibrary: jsonb('broll_library').$type<Record<string, unknown>[]>().default([]),
  higgsfieldScenes: jsonb('higgsfield_scenes').$type<Record<string, unknown>[]>().notNull().default([]),
  higgsfieldShortlist: jsonb('higgsfield_shortlist').$type<string[]>().notNull().default([]),
  // Assets stage: the reusable Character (Higgsfield Soul) bound to this production.
  characterId: text('character_id'),
  // Phase B: the production's character roster (Soul-backed) — the cast pickable per segment.
  characterIds: jsonb('character_ids').$type<string[]>().notNull().default([]),
  // My Poster approval gate (contract 06) — { [brandSlug]: 'pending' | 'approved' | 'rejected' }
  deliveryApprovals: jsonb('delivery_approvals').$type<Record<string, string>>().default({}),
  // My Poster manual pre-post checks (logo in viewport, transitions verified, brand-safe, etc.).
  deliveryChecklist: jsonb('delivery_checklist').$type<Record<string, boolean>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

/** Ad Index — unique codes assigned to approved productions. */
export const adIndex = pgTable('ad_index', {
  code: text('code').primaryKey(),
  type: text('type').notNull(),
  product: text('product').notNull(),
  region: text('region').notNull(),
  tz: text('tz').notNull(),
  version: integer('version').notNull(),
  productionId: text('production_id').references(() => productions.id, { onDelete: 'set null' }),
  status: adIndexStatusEnum('status').notNull().default('draft'),
  finalDriveId: text('final_drive_id'),
  posterDriveId: text('poster_drive_id'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

/** Uploaded inputs (images/video/reference) attached to a production — the Assets stage. */
export const assets = pgTable('assets', {
  id: text('id').primaryKey(),
  productionId: text('production_id')
    .notNull()
    .references(() => productions.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('image'), // image | video | reference
  role: text('role').notNull().default('source'), // source | brand | generated
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: text('size_bytes'),
  driveFileId: text('drive_file_id'),
  driveLink: text('drive_link'),
  status: text('status').notNull().default('stored'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

/**
 * Reusable AI Character — a Higgsfield Soul 2.0 identity (soulId) plus a rendered portrait
 * still. Bound to a production via productions.characterId so the same identity stays
 * consistent across A-Roll (talking-head portrait) and B-Roll (silent Soul-conditioned scenes).
 */
export const characters = pgTable('characters', {
  id: text('id').primaryKey(),
  brand: text('brand').notNull(),
  name: text('name').notNull(),
  soulId: text('soul_id'), // Higgsfield Soul 2.0 id (soul_id); null until a Soul is registered
  soulModel: text('soul_model').notNull().default('soul_2'), // soul_2 | soul_cinema_studio
  elementId: text('element_id'), // Higgsfield reference-element id — enables multi-subject (two-in-a-frame) shots
  portraitAssetId: text('portrait_asset_id'), // assets.id of the Soul-rendered A-Roll still
  referenceAssetIds: jsonb('reference_asset_ids').$type<string[]>().notNull().default([]),
  status: text('status').notNull().default('ready'), // ready | training | failed
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

/** Per-brand defaults for the My Poster cockpit (the post form's saved settings). */
export const brandPostDefaults = pgTable('brand_post_defaults', {
  brand: text('brand').primaryKey(),
  platforms: jsonb('platforms').$type<string[]>().notNull().default([]),
  hashtagStyle: text('hashtag_style'),
  audience: text('audience'),
  firstCommentTemplate: text('first_comment_template'),
  cadence: text('cadence'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

/** A platform-specific post (the My Poster cockpit's unit; one row per platform). */
export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  productionId: text('production_id')
    .notNull()
    .references(() => productions.id, { onDelete: 'cascade' }),
  brand: text('brand').notNull(),
  platform: text('platform').notNull(), // tiktok | youtube | instagram | facebook | linkedin | x
  status: text('status').notNull().default('draft'), // draft | scheduled | published | failed
  title: text('title'), // YouTube
  caption: text('caption'),
  hashtags: jsonb('hashtags').$type<string[]>().notNull().default([]),
  firstComment: text('first_comment'),
  coverAssetId: text('cover_asset_id'),
  switches: jsonb('switches').$type<Record<string, unknown>>(),
  scheduleAt: timestamp('schedule_at', { withTimezone: true }),
  postUrl: text('post_url'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

/** ALLIE's trend sources — per-brand RSS / Google-News feeds that keep suggestions current. */
export const brandFeeds = pgTable('brand_feeds', {
  id: text('id').primaryKey(),
  brand: text('brand').notNull(),
  url: text('url').notNull(),
  title: text('title'),
  kind: text('kind').notNull().default('rss'), // rss | gnews
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

/** ALLEN Transcriber — meeting transcripts (Postgres is the source of truth). */
export const transcripts = pgTable('transcripts', {
  id: text('id').primaryKey(),
  title: text('title'),
  brand: text('brand'),
  transcript: text('transcript').notNull(),
  summary: text('summary'),
  actionItems: jsonb('action_items').$type<string[]>().notNull().default([]),
  durationSec: real('duration_sec'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

/** ALLEN's persistent memory / knowledge base — facts Rahm commits for the concierge. */
export const allenMemories = pgTable('allen_memories', {
  id: text('id').primaryKey(),
  brand: text('brand'), // null = global
  content: text('content').notNull(),
  source: text('source').notNull().default('user'), // user | allen
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

/** Generated avatar videos (HeyGen), persisted so the dashboard can show them. */
export const videos = pgTable('videos', {
  id: text('id').primaryKey(),
  productionId: text('production_id'), // links a render back to its production (nullable for ad-hoc Studio renders)
  heygenVideoId: text('heygen_video_id').notNull(),
  status: text('status').notNull().default('processing'),
  avatarId: text('avatar_id').notNull(),
  voiceId: text('voice_id').notNull().default(''),
  inputText: text('input_text').notNull().default(''),
  title: text('title'),
  label: text('label'), // operator-set segment label used for downloaded filenames
  brand: text('brand'),
  videoUrl: text('video_url'),
  thumbnailUrl: text('thumbnail_url'),
  driveFileId: text('drive_file_id'),
  driveLink: text('drive_link'),
  source: text('source').notNull().default('heygen'), // heygen | higgsfield
  approved: boolean('approved').notNull().default(false),
  config: jsonb('config').$type<Record<string, unknown>>(), // tweak settings used for this render
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const productionJobStatus = pgEnum('production_job_status', [
  'queued',
  'running',
  'done',
  'failed',
  'cancelled'
]);

export const productionJobCapability = pgEnum('production_job_capability', [
  'aroll',
  'broll',
  'lipsync',
  'audio',
  'thumbnail',
  'poster'
]);

/** A discrete unit of work in the production pipeline — claimed and executed by the worker. */
export const productionJobs = pgTable('production_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  productionId: text('production_id')
    .notNull()
    .references(() => productions.id, { onDelete: 'cascade' }),
  capability: productionJobCapability('capability').notNull(),
  provider: text('provider').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  status: productionJobStatus('status').notNull().default('queued'),
  priority: integer('priority').notNull().default(10),
  attempt: integer('attempt').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(2),
  resultId: text('result_id'),
  error: text('error'),
  /** Lease expiry. Set on claim (now + lease) and on retry backoff (now + backoff). A
   *  `running` row whose lease has passed is presumed abandoned — see `recoverStaleJobs`. */
  lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
  /** Identity of the worker holding the lease. Written on claim; the audit trail for who ran
   *  a job, and what to name when a lease expires. */
  workerId: text('worker_id'),
  /** Caller-supplied dedupe identity. NULL (the default, and every pre-Phase-A row) means no
   *  dedupe requested. A non-NULL value is UNIQUE across the table via a partial index, so a
   *  duplicate submission returns the original job instead of enqueuing paid work twice. */
  idempotencyKey: text('idempotency_key'),
  enqueuedAt: timestamp('enqueued_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),

  // ── Phase B1 (migration 0024) ──────────────────────────────────────────────────────
  /** Sibling parent for non-video work. Exactly one of `productionId` / `workItemId` is
   *  set, by CHECK — `productionId` is nullable from 0024 onward for that reason. */
  workItemId: uuid('work_item_id'),
  /** The policy rule that gated this job. Written atomically at enqueue from SERVER-SIDE
   *  policy, never from caller input, and frozen thereafter by trigger. */
  gateOrigin: text('gate_origin'),
  gateSubjectType: text('gate_subject_type'),
  gateSubjectId: text('gate_subject_id'),
  gateScope: text('gate_scope'),
  /** Re-stamped at each legitimate resume — deliberately NOT frozen, since claim-time
   *  revalidation compares against it. */
  approvedRevisionDigest: text('approved_revision_digest'),
  /** 'gated' | 'ungated'. NULL means UNRESOLVED and nothing else; an unresolved job is not
   *  claimable. Without this, NULL would have to mean both "policy says no gate" and "the
   *  backfill missed this row", which claim cannot disambiguate — `autonomy_level` is a
   *  resolveGate input and is not persisted here. */
  gateResolution: text('gate_resolution')
});

/** A single run of a Recipe — the unit the orchestrator tracks. */
export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipes.id),
  brand: text('brand').notNull(),
  status: jobStatusEnum('status').notNull().default('queued'),
  input: jsonb('input').$type<JobInput>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// ── Phase B1 governance primitives ──────────────────────────────────────────────────────
// Migrations 0023 (enums) + 0024 (everything referencing them). Design:
// docs/atelier/phase-b-governance-primitives-design.md §3.
//
// Creator OS records WHO acted; the PIAAR fabric decides WHETHER they were authorized.
// `principalId` is opaque text and is never resolved or granted on here.

export const principalKind = pgEnum('principal_kind', [
  'human',
  'agent',
  'processor',
  'domain-service'
]);

export const signingKeyStatus = pgEnum('signing_key_status', ['active', 'revoked']);

export const publicationIntentPhase = pgEnum('publication_intent_phase', [
  'claimed',
  'transmitting',
  'published',
  'failed',
  /** Remote outcome genuinely unknown (response lost past the lease). Holds the open-intent
   *  slot deliberately: releasing it could admit a duplicate publish. Operator-reconciled. */
  'unknown'
]);

/** Domain signing keys. Append-only in status AND existence — see the 0024 trigger. */
export const signingKeys = pgTable('signing_keys', {
  keyId: text('key_id').primaryKey(),
  domain: text('domain').notNull(),
  publicKey: text('public_key').notNull(),
  status: signingKeyStatus('status').notNull().default('active'),
  activatedAt: timestamp('activated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' })
});

/** Append-only record of who decided what about which revision. Enforced by trigger, not by
 *  convention: only the two supersession columns may ever change, and both are monotonic. */
export const approvalEvidence = pgTable('approval_evidence', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  /** Brand slug for the delivery gate; '*' when whole-subject. */
  scope: text('scope').notNull(),
  revisionDigest: text('revision_digest').notNull(),
  /** approved | approved_with_note | rejected | revision_required | withdrawn */
  decision: text('decision').notNull(),
  notes: text('notes'),
  principalId: text('principal_id').notNull(),
  principalKind: principalKind('principal_kind').notNull(),
  assertedRole: text('asserted_role').notNull(),
  sourceSystem: text('source_system').notNull(),
  authorizationRef: text('authorization_ref'),
  /** The complete outbound package this decision authorizes; the digest covers it. */
  approvedPackage: jsonb('approved_package').$type<Record<string, unknown>>(),
  signingKeyId: text('signing_key_id').references(() => signingKeys.keyId),
  assertionId: text('assertion_id'),
  /** Monotonic per (subject, scope). Freshness is not ordering: two assertions minted inside
   *  one age window can arrive out of order, and without an ordinal the older approval would
   *  supersede the newer rejection. */
  decisionSeq: bigint('decision_seq', { mode: 'number' }).notNull(),
  /** When the DECISION was made, as distinct from when Creator OS recorded it. NULL only for
   *  legacy backfilled rows, whose original decision time is genuinely unknown — writing the
   *  migration timestamp would present it as the founder's. */
  decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
  provenance: jsonb('provenance').$type<Record<string, unknown>>().notNull().default({}),
  /** Set FIRST when superseding; governs liveness. */
  supersededAt: timestamp('superseded_at', { withTimezone: true, mode: 'date' }),
  supersededBy: uuid('superseded_by'),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
});

/** Attributed state changes, written in the same transaction as the change they record.
 *  Authority context is on every row, including transitions with no linked evidence. */
export const workflowTransitions = pgTable('workflow_transitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  reason: text('reason'),
  evidenceId: uuid('evidence_id').references(() => approvalEvidence.id),
  principalId: text('principal_id').notNull(),
  principalKind: principalKind('principal_kind').notNull(),
  assertedRole: text('asserted_role').notNull(),
  sourceSystem: text('source_system').notNull(),
  authContext: jsonb('auth_context').$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
});

/** Sibling parent to `productions` for non-video work (Accord articles). A job points at
 *  exactly one parent, so the existing video claim path is untouched. */
export const workItems = pgTable('work_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  brand: text('brand').notNull(),
  title: text('title'),
  state: text('state').notNull().default('active'),
  externalRef: text('external_ref'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()
});

/** Serializes withdrawal against an in-flight publish. A gate read is a moment; publication
 *  is an interval, and without this a withdrawal committing inside that interval still lets
 *  the post go out. One open intent per (subject, scope), by partial unique index. */
export const publicationIntents = pgTable('publication_intents', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  scope: text('scope').notNull(),
  evidenceId: uuid('evidence_id').notNull().references(() => approvalEvidence.id),
  revisionDigest: text('revision_digest').notNull(),
  phase: publicationIntentPhase('phase').notNull().default('claimed'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  remotePostId: text('remote_post_id'),
  claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' })
});
