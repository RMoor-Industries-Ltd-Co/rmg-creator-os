import { pgTable, text, timestamp, jsonb, pgEnum, real, boolean, uuid, integer } from 'drizzle-orm/pg-core';
import type { InputKind, JobInput, OutputKind, RecipeStep } from '@rmg-creator-os/types';

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
  taggedScript: text('tagged_script'), // script annotated with eleven_v3 audio tags
  stabilityMode: text('stability_mode'), // creative | natural | robust
  stability: real('stability'), // 0.0 / 0.5 / 1.0
  audioTagPalette: text('audio_tag_palette'),
  intensity: text('intensity'),
  voiceId: text('voice_id'), // resolved ElevenLabs voice for the speaker
  emotionLocked: boolean('emotion_locked').notNull().default(false),
  stage: text('stage').notNull().default('script'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
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
  productionId: uuid('production_id')
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
  lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
  workerId: text('worker_id'),
  enqueuedAt: timestamp('enqueued_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' })
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
