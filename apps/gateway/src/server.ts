// apps/gateway/src/server.ts
// The RMG Creator OS control plane: orchestrator API the dashboard talks to.

import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import {
  allenConfigured,
  allenDirect,
  allenDraft,
  allenEmotionProfiles,
  allenSpeak
} from './allen.js';
import { and, createDb, desc, eq, runMigrations, tables } from '@rmg-creator-os/db';
import { createDriveClient, createHeyGenClient, HeyGenError } from '@rmg-creator-os/integrations';
import type { HealthResponse, JobInput } from '@rmg-creator-os/types';
import Fastify from 'fastify';
import { Redis } from 'ioredis';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const REDIS_URL = process.env.REDIS_URL ?? '';
const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY ?? '';
const GDRIVE_VIDEO_FOLDER_ID = process.env.GDRIVE_VIDEO_FOLDER_ID ?? '';
const GDRIVE_IMAGE_FOLDER_ID = process.env.GDRIVE_IMAGE_FOLDER_ID ?? '';
const GDRIVE_AUDIO_FOLDER_ID = process.env.GDRIVE_AUDIO_FOLDER_ID ?? '';
// Public base the gateway is reachable at, so HeyGen can fetch hosted audio.
const PUBLIC_API_BASE = (process.env.PUBLIC_API_BASE ?? '').replace(/\/$/, '');

const { db, pool } = createDb(DATABASE_URL);
const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
const heygen = HEYGEN_API_KEY ? createHeyGenClient(HEYGEN_API_KEY) : null;
const drive =
  process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET && process.env.GDRIVE_REFRESH_TOKEN
    ? createDriveClient({
        clientId: process.env.GDRIVE_CLIENT_ID,
        clientSecret: process.env.GDRIVE_CLIENT_SECRET,
        refreshToken: process.env.GDRIVE_REFRESH_TOKEN
      })
    : null;

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB/file

// Apply pending DB migrations on startup (idempotent). Disable with RUN_MIGRATIONS=false.
if (process.env.RUN_MIGRATIONS !== 'false') {
  try {
    await runMigrations(DATABASE_URL);
    app.log.info('migrations applied');
  } catch (err) {
    app.log.error({ err }, 'migration failed');
    process.exit(1);
  }
}

app.get('/health', async (): Promise<HealthResponse> => {
  const checks: Record<string, 'ok' | 'fail'> = {};
  try {
    await pool.query('select 1');
    checks.postgres = 'ok';
  } catch {
    checks.postgres = 'fail';
  }
  try {
    checks.redis = (await redis.ping()) === 'PONG' ? 'ok' : 'fail';
  } catch {
    checks.redis = 'fail';
  }
  const status = Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'degraded';
  return { status, service: 'gateway', checks, time: new Date().toISOString() };
});

app.get('/recipes', async () => db.select().from(tables.recipes));

app.get('/jobs', async () => db.select().from(tables.jobs));

app.post<{ Body: { recipeId?: string; brand?: string; input?: JobInput } }>(
  '/jobs',
  async (request, reply) => {
    const { recipeId, brand, input } = request.body ?? {};
    if (!recipeId || !brand || !input) {
      return reply.code(400).send({ error: 'recipeId, brand, and input are required' });
    }
    const now = new Date();
    const [job] = await db
      .insert(tables.jobs)
      .values({ id: crypto.randomUUID(), recipeId, brand, status: 'queued', input, createdAt: now, updatedAt: now })
      .returning();
    return reply.code(201).send(job);
  }
);

// --- HeyGen (avatar video) -------------------------------------------------
// Returns 503 until HEYGEN_API_KEY is configured on the server.
function withHeyGen(reply: import('fastify').FastifyReply) {
  if (!heygen) {
    reply.code(503).send({ error: 'HeyGen not configured (set HEYGEN_API_KEY)' });
    return null;
  }
  return heygen;
}

async function heygenHandler<T>(reply: import('fastify').FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HeyGenError) {
      return reply.code(err.status && err.status >= 400 ? err.status : 502).send({
        error: err.message,
        details: err.body
      });
    }
    throw err;
  }
}

app.get('/heygen/avatars', async (_request, reply) => {
  const client = withHeyGen(reply);
  if (!client) return reply;
  return heygenHandler(reply, () => client.listAvatars());
});

app.get('/heygen/voices', async (_request, reply) => {
  const client = withHeyGen(reply);
  if (!client) return reply;
  return heygenHandler(reply, () => client.listVoices());
});

// Generate a video AND record it so the dashboard can show it later.
app.post<{
  Body: {
    avatarId?: string;
    voiceId?: string;
    text?: string;
    avatarStyle?: string;
    dimension?: { width: number; height: number };
    title?: string;
    brand?: string;
  };
}>('/heygen/videos', async (request, reply) => {
  const client = withHeyGen(reply);
  if (!client) return reply;
  const { avatarId, voiceId, text, avatarStyle, dimension, title, brand } = request.body ?? {};
  if (!avatarId || !voiceId || !text) {
    return reply.code(400).send({ error: 'avatarId, voiceId, and text are required' });
  }
  return heygenHandler(reply, async () => {
    const { videoId } = await client.generateVideo({
      avatarId,
      voiceId,
      inputText: text,
      avatarStyle,
      dimension,
      title
    });
    const now = new Date();
    const [row] = await db
      .insert(tables.videos)
      .values({
        id: crypto.randomUUID(),
        heygenVideoId: videoId,
        status: 'processing',
        avatarId,
        voiceId,
        inputText: text,
        title: title ?? null,
        brand: brand ?? null,
        createdAt: now,
        updatedAt: now
      })
      .returning();
    reply.code(201);
    return row;
  });
});

// List recorded videos, newest first.
app.get('/heygen/videos', async () =>
  db.select().from(tables.videos).orderBy(desc(tables.videos.createdAt))
);

type VideoRecord = typeof tables.videos.$inferSelect;

// Once a video is completed, copy the MP4 into Drive (VIDEO_PRODUCTION) and record
// the file id + link. Idempotent; retries on the next poll if it fails.
async function saveVideoToDrive(row: VideoRecord): Promise<VideoRecord> {
  if (!drive || !GDRIVE_VIDEO_FOLDER_ID) return row;
  if (row.status !== 'completed' || !row.videoUrl || row.driveFileId) return row;
  try {
    const base = (row.title || row.inputText).slice(0, 40).replace(/[^\w.-]+/g, '_');
    const { fileId, webViewLink } = await drive.uploadFromUrl({
      url: row.videoUrl,
      name: `${base}_${row.id.slice(0, 8)}.mp4`,
      folderId: GDRIVE_VIDEO_FOLDER_ID,
      mimeType: 'video/mp4'
    });
    const [u] = await db
      .update(tables.videos)
      .set({ driveFileId: fileId, driveLink: webViewLink ?? null, updatedAt: new Date() })
      .where(eq(tables.videos.id, row.id))
      .returning();
    app.log.info({ id: row.id, fileId }, 'video saved to Drive');
    return u;
  } catch (err) {
    app.log.error({ err, id: row.id }, 'Drive save failed (will retry)');
    return row;
  }
}

// Fetch one recorded video; refresh its status from HeyGen if still in progress,
// then ensure it's archived to Drive.
app.get<{ Params: { id: string } }>('/heygen/videos/:id', async (request, reply) => {
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'video not found' });
  const client = heygen;
  if (row.status === 'completed' || row.status === 'failed' || !client) {
    return saveVideoToDrive(row);
  }

  return heygenHandler(reply, async () => {
    const s = await client.getVideoStatus(row.heygenVideoId);
    const [updated] = await db
      .update(tables.videos)
      .set({
        status: s.status,
        videoUrl: s.videoUrl ?? row.videoUrl,
        thumbnailUrl: s.thumbnailUrl ?? row.thumbnailUrl,
        updatedAt: new Date()
      })
      .where(eq(tables.videos.id, row.id))
      .returning();
    return saveVideoToDrive(updated);
  });
});

// --- Productions (the wizard's unit; Script stage = intake → ALLEN draft) -----

// Intake: a topic (+ optional context) → ALLEN writes a brand-voice script + Doc draft.
app.post<{
  Body: { brand?: string; topic?: string; persona?: string; outputKind?: string; context?: string };
}>('/productions', async (request, reply) => {
  if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured (set ALLEN_URL)' });
  const { brand, topic, persona, outputKind, context } = request.body ?? {};
  if (!brand || !topic) return reply.code(400).send({ error: 'brand and topic are required' });

  let draft;
  try {
    draft = await allenDraft({
      brand,
      topic,
      persona,
      output_kind: outputKind ?? 'post',
      allie_context: context,
      write_doc: true
    });
  } catch (err) {
    return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
  }

  const now = new Date();
  const [row] = await db
    .insert(tables.productions)
    .values({
      id: crypto.randomUUID(),
      brand,
      persona: persona ?? null,
      outputKind: outputKind ?? 'post',
      topic,
      context: context ?? null,
      title: draft.title,
      scriptText: draft.script,
      scriptDocId: draft.doc_id ?? null,
      scriptDocUrl: draft.doc_url ?? null,
      scriptStatus: 'draft',
      model: draft.model,
      stage: 'script',
      status: 'active',
      createdAt: now,
      updatedAt: now
    })
    .returning();
  return reply.code(201).send(row);
});

app.get('/productions', async () =>
  db.select().from(tables.productions).orderBy(desc(tables.productions.createdAt))
);

app.get<{ Params: { id: string } }>('/productions/:id', async (request, reply) => {
  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });
  return row;
});

// Emotion profiles + tag rules for the Voice Direction step (proxies ALLEN).
app.get('/emotion/profiles', async (_request, reply) => {
  if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured (set ALLEN_URL)' });
  try {
    return await allenEmotionProfiles();
  } catch (err) {
    return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
  }
});

// Voice Direction: apply a brand's emotional register to the approved script.
// Persists the tagged script + stability so the render can use eleven_v3.
// Pass { lock: true } to lock the settings in and advance the stage.
app.post<{
  Params: { id: string };
  Body: { voiceBrand?: string; intensity?: string; stabilityMode?: string; lock?: boolean };
}>('/productions/:id/direct', async (request, reply) => {
  if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured (set ALLEN_URL)' });
  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });
  if (!row.scriptText) return reply.code(400).send({ error: 'no script to direct' });

  const { voiceBrand, intensity, stabilityMode, lock } = request.body ?? {};
  const brand = voiceBrand || row.brand;
  let result;
  try {
    result = await allenDirect({
      script: row.scriptText,
      brand,
      persona: row.persona ?? undefined,
      intensity: intensity ?? undefined,
      stability_mode: stabilityMode ?? undefined
    });
  } catch (err) {
    return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
  }

  const [updated] = await db
    .update(tables.productions)
    .set({
      voiceBrand: brand,
      taggedScript: result.tagged_script,
      stabilityMode: result.stability_mode,
      stability: result.stability,
      audioTagPalette: result.audio_tag_palette,
      intensity: intensity ?? row.intensity,
      emotionLocked: lock ? true : row.emotionLocked,
      stage: lock ? 'assets' : row.stage,
      updatedAt: new Date()
    })
    .where(eq(tables.productions.id, row.id))
    .returning();
  return updated;
});

// Hear the script in the brand voice (proxies ALLEN /speak → audio).
// { directed: true } renders the emotion-tagged script with eleven_v3 + stability.
app.post<{
  Params: { id: string };
  Body: { directed?: boolean; stabilityMode?: string };
}>('/productions/:id/speak', async (request, reply) => {
  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });
  const { directed, stabilityMode } = request.body ?? {};

  const useDirected = directed && row.taggedScript;
  const text = useDirected ? row.taggedScript! : row.scriptText;
  if (!text) return reply.code(400).send({ error: 'no script to speak' });

  const STABILITY: Record<string, number> = { creative: 0.0, natural: 0.5, robust: 1.0 };
  const stability = useDirected
    ? (stabilityMode ? STABILITY[stabilityMode] : undefined) ?? row.stability ?? 0.5
    : undefined;

  try {
    const audio = await allenSpeak(text, {
      voiceId: row.voiceId ?? undefined,
      modelId: useDirected ? 'eleven_v3' : undefined,
      stability
    });
    reply.header('Content-Type', 'audio/mpeg');
    return reply.send(audio);
  } catch (err) {
    return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
  }
});

// --- Assets (the wizard's Assets stage) -----------------------------------
// Uploaded images/video attached to a production, stored privately in Drive
// (IMAGE_PRODUCTION). The dashboard displays them via the /raw proxy below.

function kindFor(mime: string): 'image' | 'video' | 'reference' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'reference';
}

// Upload one or more files to a production.
app.post<{ Params: { id: string } }>('/productions/:id/assets', async (request, reply) => {
  if (!drive) return reply.code(503).send({ error: 'Drive not configured (set GDRIVE_*)' });
  if (!GDRIVE_IMAGE_FOLDER_ID) {
    return reply.code(503).send({ error: 'Asset storage not configured (set GDRIVE_IMAGE_FOLDER_ID)' });
  }
  const [prod] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!prod) return reply.code(404).send({ error: 'production not found' });

  const saved: (typeof tables.assets.$inferSelect)[] = [];
  try {
    for await (const part of request.files()) {
      const bytes = await part.toBuffer();
      const mime = part.mimetype || 'application/octet-stream';
      const safe = (part.filename || 'upload').replace(/[^\w.-]+/g, '_').slice(0, 60);
      const { fileId, webViewLink } = await drive.uploadBuffer({
        bytes,
        name: `${prod.id.slice(0, 8)}_${safe}`,
        folderId: GDRIVE_IMAGE_FOLDER_ID,
        mimeType: mime
      });
      const [row] = await db
        .insert(tables.assets)
        .values({
          id: crypto.randomUUID(),
          productionId: prod.id,
          kind: kindFor(mime),
          role: 'source',
          fileName: part.filename || safe,
          mimeType: mime,
          sizeBytes: String(bytes.length),
          driveFileId: fileId,
          driveLink: webViewLink ?? null,
          status: 'stored',
          createdAt: new Date()
        })
        .returning();
      saved.push(row);
    }
  } catch (err) {
    return reply.code(502).send({ error: `upload failed: ${(err as Error).message}` });
  }
  if (saved.length === 0) return reply.code(400).send({ error: 'no files in request' });
  // Advance the stage once the production has assets.
  if (prod.stage === 'script' || prod.stage === 'voice' || prod.stage === 'assets') {
    await db
      .update(tables.productions)
      .set({ stage: 'assets', updatedAt: new Date() })
      .where(eq(tables.productions.id, prod.id));
  }
  return reply.code(201).send(saved);
});

// List a production's assets, newest first.
app.get<{ Params: { id: string } }>('/productions/:id/assets', async (request) =>
  db
    .select()
    .from(tables.assets)
    .where(eq(tables.assets.productionId, request.params.id))
    .orderBy(desc(tables.assets.createdAt))
);

// Stream an asset's bytes (so the dashboard can show private Drive images inline).
app.get<{ Params: { assetId: string } }>('/assets/:assetId/raw', async (request, reply) => {
  const [row] = await db.select().from(tables.assets).where(eq(tables.assets.id, request.params.assetId));
  if (!row || !row.driveFileId) return reply.code(404).send({ error: 'asset not found' });
  if (!drive) return reply.code(503).send({ error: 'Drive not configured' });
  try {
    const { bytes, mimeType } = await drive.download(row.driveFileId);
    reply.header('Content-Type', row.mimeType || mimeType);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(bytes);
  } catch (err) {
    return reply.code(502).send({ error: `Drive: ${(err as Error).message}` });
  }
});

// Remove an asset (deletes the Drive file too).
app.delete<{ Params: { assetId: string } }>('/assets/:assetId', async (request, reply) => {
  const [row] = await db.select().from(tables.assets).where(eq(tables.assets.id, request.params.assetId));
  if (!row) return reply.code(404).send({ error: 'asset not found' });
  if (drive && row.driveFileId) {
    try {
      await drive.deleteFile(row.driveFileId);
    } catch (err) {
      app.log.warn({ err, id: row.id }, 'Drive delete failed (removing record anyway)');
    }
  }
  await db.delete(tables.assets).where(eq(tables.assets.id, row.id));
  return { ok: true };
});

// --- Generate (the wizard's Generate stage) -------------------------------
// Render ALLEN's emotion-directed audio, host it, and lip-sync a HeyGen avatar
// to it. The result links back to the production.
const STABILITY: Record<string, number> = { creative: 0.0, natural: 0.5, robust: 1.0 };

app.post<{
  Params: { id: string };
  Body: {
    avatarId?: string;
    avatarStyle?: string;
    background?: { type: 'color'; value: string };
    dimension?: { width: number; height: number };
    stabilityMode?: string;
  };
}>('/productions/:id/generate', async (request, reply) => {
  const client = withHeyGen(reply);
  if (!client) return reply;
  if (!drive || !GDRIVE_AUDIO_FOLDER_ID) {
    return reply.code(503).send({ error: 'Audio storage not configured (set GDRIVE_AUDIO_FOLDER_ID)' });
  }
  if (!PUBLIC_API_BASE) {
    return reply.code(503).send({ error: 'PUBLIC_API_BASE not set (HeyGen needs a public audio URL)' });
  }
  const { avatarId, avatarStyle, background, dimension, stabilityMode } = request.body ?? {};
  if (!avatarId) return reply.code(400).send({ error: 'avatarId is required' });

  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });

  // Prefer the emotion-directed script (v3 audio tags); fall back to plain script.
  const directed = Boolean(row.taggedScript);
  const text = directed ? row.taggedScript! : row.scriptText;
  if (!text) return reply.code(400).send({ error: 'no script to generate from' });
  const stability = directed
    ? (stabilityMode && STABILITY[stabilityMode] != null ? STABILITY[stabilityMode] : row.stability ?? 0.5)
    : undefined;

  try {
    // 1) Render the brand voice (directed → eleven_v3 + stability).
    const audio = await allenSpeak(text, {
      voiceId: row.voiceId ?? undefined,
      modelId: directed ? 'eleven_v3' : undefined,
      stability
    });
    // 2) Host it (Drive AUDIO_PRODUCTION) as an asset the gateway can serve.
    const base = (row.title || row.topic).slice(0, 40).replace(/[^\w.-]+/g, '_');
    const { fileId, webViewLink } = await drive.uploadBuffer({
      bytes: audio,
      name: `${row.id.slice(0, 8)}_${base}.mp3`,
      folderId: GDRIVE_AUDIO_FOLDER_ID,
      mimeType: 'audio/mpeg'
    });
    const [audioAsset] = await db
      .insert(tables.assets)
      .values({
        id: crypto.randomUUID(),
        productionId: row.id,
        kind: 'audio',
        role: 'generated',
        fileName: `${base}.mp3`,
        mimeType: 'audio/mpeg',
        sizeBytes: String(audio.length),
        driveFileId: fileId,
        driveLink: webViewLink ?? null,
        status: 'stored',
        createdAt: new Date()
      })
      .returning();
    const audioUrl = `${PUBLIC_API_BASE}/assets/${audioAsset.id}/raw`;

    // 3) Lip-sync the avatar to that audio.
    const dim = dimension ?? { width: 720, height: 1280 };
    return await heygenHandler(reply, async () => {
      const { videoId } = await client.generateVideo({
        avatarId,
        avatarStyle,
        background,
        audioUrl,
        dimension: dim,
        title: row.title ?? undefined
      });
      const now = new Date();
      const [video] = await db
        .insert(tables.videos)
        .values({
          id: crypto.randomUUID(),
          productionId: row.id,
          heygenVideoId: videoId,
          status: 'processing',
          source: 'heygen',
          avatarId,
          inputText: text.slice(0, 2000),
          title: row.title ?? null,
          brand: row.brand,
          config: { avatarId, avatarStyle, background, dimension: dim, stabilityMode },
          createdAt: now,
          updatedAt: now
        })
        .returning();
      await db
        .update(tables.productions)
        .set({ stage: 'generate', updatedAt: now })
        .where(eq(tables.productions.id, row.id));
      reply.code(201);
      return video;
    });
  } catch (err) {
    return reply.code(502).send({ error: `generate failed: ${(err as Error).message}` });
  }
});

// Videos rendered for a production, newest first.
app.get<{ Params: { id: string } }>('/productions/:id/videos', async (request) =>
  db
    .select()
    .from(tables.videos)
    .where(eq(tables.videos.productionId, request.params.id))
    .orderBy(desc(tables.videos.createdAt))
);

// Approve a render — locks it in (one approved per production+source) and advances.
app.post<{ Params: { id: string } }>('/videos/:id/approve', async (request, reply) => {
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'video not found' });
  if (row.status !== 'completed') {
    return reply.code(400).send({ error: `cannot approve a ${row.status} render` });
  }
  // Clear any prior approval for this production + source, then approve this one.
  if (row.productionId) {
    await db
      .update(tables.videos)
      .set({ approved: false, updatedAt: new Date() })
      .where(and(eq(tables.videos.productionId, row.productionId), eq(tables.videos.source, row.source)));
  }
  const [updated] = await db
    .update(tables.videos)
    .set({ approved: true, updatedAt: new Date() })
    .where(eq(tables.videos.id, row.id))
    .returning();
  // HeyGen render approved → ready to schedule.
  if (row.productionId && row.source === 'heygen') {
    await db
      .update(tables.productions)
      .set({ stage: 'schedule', updatedAt: new Date() })
      .where(eq(tables.productions.id, row.productionId));
  }
  return updated;
});

// Discard a render (rejected take) — removes the record + its Drive copy.
app.delete<{ Params: { id: string } }>('/videos/:id', async (request, reply) => {
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'video not found' });
  if (drive && row.driveFileId) {
    try {
      await drive.deleteFile(row.driveFileId);
    } catch (err) {
      app.log.warn({ err, id: row.id }, 'Drive delete failed (removing record anyway)');
    }
  }
  await db.delete(tables.videos).where(eq(tables.videos.id, row.id));
  return { ok: true };
});

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
