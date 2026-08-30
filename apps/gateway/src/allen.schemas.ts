// Runtime validation for the highest-risk ALLEN responses (Sprint 1 PR 3 — the AI→production
// boundary). These three functions previously cast the parsed JSON straight into the production
// pipeline; here we parse-not-cast so a genuinely malformed response fails fast with a clean
// error instead of letting `undefined`/wrong-typed values reach TTS/publish logic.
//
// Design intent (per the approved plan): PERMISSIVE, not pedantic.
//  - Only the crash-critical fields are required (draft.script, direct.tagged_script, and that
//    metadata.hashtags is an ARRAY, not a string).
//  - Everything else is optional with a sensible default, so a valid-but-loose response is
//    accepted, not rejected.
//  - `.passthrough()` keeps unknown/extra keys — new ALLEN fields never break validation.
//  - `stability` is coerced (accepts a numeric string) and defaults to a neutral 0.5 when absent.

import { z } from 'zod';

/** `/draft` — script + title feed the entire production pipeline; script is non-negotiable. */
export const AllenDraftSchema = z
  .object({
    title: z.string().optional().default(''),
    script: z.string(), // required: a draft with no script is malformed
    model: z.string().optional().default(''),
    doc_url: z.string().optional(),
    doc_id: z.string().optional()
  })
  .passthrough();

/** `/direct` — tagged_script drives ElevenLabs TTS; stability is a tuning number (lenient). */
export const AllenDirectSchema = z
  .object({
    tagged_script: z.string(), // required: the annotated script the voice is synthesized from
    stability_mode: z.string().optional().default(''),
    stability: z.coerce.number().finite().optional().default(0.5),
    audio_tag_palette: z.string().optional().default(''),
    version: z.string().optional().default('')
  })
  .passthrough();

/** `/metadata` — publish metadata; hashtags MUST be an array (downstream maps/joins it). */
export const AllenMetadataSchema = z
  .object({
    title: z.string().optional().default(''),
    caption: z.string().optional().default(''),
    hashtags: z.array(z.string()).optional().default([]),
    first_comment: z.string().optional().default(''),
    audience: z.string().optional().default('')
  })
  .passthrough();

/**
 * Validate an ALLEN response against `schema`, returning typed data or throwing a clean,
 * non-sensitive error the existing route handlers surface as a 502. The message names the
 * failing fields (paths + zod messages) — never dumps the raw payload.
 */
export function parseAllen<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const summary = result.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  throw new Error(`ALLEN ${label} returned malformed data (${summary})`);
}
