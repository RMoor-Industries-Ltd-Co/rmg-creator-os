import { pgTable, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
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
