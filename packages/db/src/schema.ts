import { pgTable, text, timestamp, jsonb, pgEnum, real, boolean } from 'drizzle-orm/pg-core';
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

/** Generated avatar videos (HeyGen), persisted so the dashboard can show them. */
export const videos = pgTable('videos', {
  id: text('id').primaryKey(),
  heygenVideoId: text('heygen_video_id').notNull(),
  status: text('status').notNull().default('processing'),
  avatarId: text('avatar_id').notNull(),
  voiceId: text('voice_id').notNull(),
  inputText: text('input_text').notNull(),
  title: text('title'),
  brand: text('brand'),
  videoUrl: text('video_url'),
  thumbnailUrl: text('thumbnail_url'),
  driveFileId: text('drive_file_id'),
  driveLink: text('drive_link'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
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
