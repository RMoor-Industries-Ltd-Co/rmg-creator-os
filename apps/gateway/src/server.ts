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
import {
  createDriveClient,
  createHeyGenClient,
  createHiggsfieldClient,
  createStockClient,
  HeyGenError
} from '@rmg-creator-os/integrations';
import type { HealthResponse, JobInput } from '@rmg-creator-os/types';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeSequence, type Segment } from './compose.js';
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
const higgs = process.env.HIGGSFIELD_ENABLED === 'true' ? createHiggsfieldClient() : null;
const stock = createStockClient({
  pexelsKey: process.env.PEXELS_API_KEY,
  pixabayKey: process.env.PIXABAY_API_KEY
});
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

// Save a finished Higgsfield asset (image or video) into the right Drive folder.
async function saveHiggsfieldToDrive(row: VideoRecord): Promise<VideoRecord> {
  if (!drive || row.status !== 'completed' || !row.videoUrl || row.driveFileId) return row;
  const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(row.videoUrl);
  const folder = isVideo ? GDRIVE_VIDEO_FOLDER_ID : GDRIVE_IMAGE_FOLDER_ID;
  if (!folder) return row;
  try {
    const base = (row.title || row.inputText).slice(0, 40).replace(/[^\w.-]+/g, '_') || 'higgsfield';
    const { fileId, webViewLink } = await drive.uploadFromUrl({
      url: row.videoUrl,
      name: `${base}_${row.id.slice(0, 8)}.${isVideo ? 'mp4' : 'png'}`,
      folderId: folder,
      mimeType: isVideo ? 'video/mp4' : 'image/png'
    });
    const [u] = await db
      .update(tables.videos)
      .set({ driveFileId: fileId, driveLink: webViewLink ?? null, updatedAt: new Date() })
      .where(eq(tables.videos.id, row.id))
      .returning();
    return u;
  } catch (err) {
    app.log.error({ err, id: row.id }, 'Higgsfield Drive save failed (will retry)');
    return row;
  }
}

// Fetch one recorded video; refresh its status (HeyGen or Higgsfield) if still in
// progress, then ensure it's archived to Drive.
app.get<{ Params: { id: string } }>('/heygen/videos/:id', async (request, reply) => {
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'video not found' });

  // Custom/final renders update in-place (ffmpeg job); stock clips are already final.
  if (row.source === 'custom' || row.source === 'final' || row.source === 'stock') return row;

  // Higgsfield renders poll a different backend (the CLI).
  if (row.source === 'higgsfield') {
    if (row.status === 'completed' || row.status === 'failed' || !higgs) {
      return saveHiggsfieldToDrive(row);
    }
    try {
      const j = await higgs.getJob(row.heygenVideoId);
      const status =
        j.status === 'completed' ? 'completed' : ['failed', 'nsfw', 'error'].includes(j.status) ? 'failed' : 'processing';
      const [u] = await db
        .update(tables.videos)
        .set({ status, videoUrl: j.resultUrl ?? row.videoUrl, updatedAt: new Date() })
        .where(eq(tables.videos.id, row.id))
        .returning();
      return saveHiggsfieldToDrive(u);
    } catch (err) {
      app.log.error({ err, id: row.id }, 'Higgsfield status poll failed');
      return row;
    }
  }

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

function kindFor(mime: string): 'image' | 'video' | 'audio' | 'reference' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
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

// --- Higgsfield (imagery: image/video generation via the authed CLI) ---------
function withHiggs(reply: import('fastify').FastifyReply) {
  if (!higgs) {
    reply.code(503).send({ error: 'Higgsfield not enabled (set HIGGSFIELD_ENABLED + mount credentials)' });
    return null;
  }
  return higgs;
}

// Available generation models (default: image).
app.get<{ Querystring: { type?: 'image' | 'video' } }>('/higgsfield/models', async (request, reply) => {
  const client = withHiggs(reply);
  if (!client) return reply;
  try {
    return await client.listModels(request.query.type ?? 'image');
  } catch (err) {
    return reply.code(502).send({ error: `Higgsfield: ${(err as Error).message}` });
  }
});

// Generate imagery for a production (optionally from an uploaded source image).
app.post<{
  Params: { id: string };
  Body: { prompt?: string; model?: string; sourceAssetId?: string };
}>('/productions/:id/higgsfield', async (request, reply) => {
  const client = withHiggs(reply);
  if (!client) return reply;
  const { prompt, model, sourceAssetId } = request.body ?? {};
  if (!prompt || !model) return reply.code(400).send({ error: 'prompt and model are required' });

  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });

  // Pull the source image down to a temp file if one was chosen.
  let imagePath: string | undefined;
  if (sourceAssetId) {
    const [asset] = await db.select().from(tables.assets).where(eq(tables.assets.id, sourceAssetId));
    if (!asset || !asset.driveFileId) return reply.code(404).send({ error: 'source asset not found' });
    if (!drive) return reply.code(503).send({ error: 'Drive not configured' });
    try {
      const { bytes } = await drive.download(asset.driveFileId);
      const ext = (asset.mimeType.split('/')[1] || 'png').replace(/[^\w]/g, '');
      imagePath = join(tmpdir(), `hf_${randomUUID()}.${ext}`);
      await writeFile(imagePath, bytes);
    } catch (err) {
      return reply.code(502).send({ error: `source download failed: ${(err as Error).message}` });
    }
  }

  try {
    const { jobId } = await client.createJob({ model, prompt, imagePath });
    const now = new Date();
    const [video] = await db
      .insert(tables.videos)
      .values({
        id: crypto.randomUUID(),
        productionId: row.id,
        heygenVideoId: jobId, // external job id (Higgsfield)
        status: 'processing',
        source: 'higgsfield',
        avatarId: '',
        inputText: prompt.slice(0, 2000),
        title: row.title ?? null,
        brand: row.brand,
        config: { model, prompt, sourceAssetId: sourceAssetId ?? null },
        createdAt: now,
        updatedAt: now
      })
      .returning();
    return reply.code(201).send(video);
  } catch (err) {
    return reply.code(502).send({ error: `Higgsfield generate failed: ${(err as Error).message}` });
  }
});

// --- Custom video (operator's own images + own voice, no avatar) -------------
// Background-renders a slideshow with ffmpeg, then marks the row completed.
async function renderCustomVideo(
  videoId: string,
  opts: {
    productionId: string;
    imageAssetIds: string[];
    audioAssetId?: string;
    broll?: boolean;
    brollQuery?: string;
    orientation: 'portrait' | 'landscape';
    width: number;
    height: number;
  }
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'compose-'));
  try {
    // Resolve the voice track: an uploaded voiceover, or synth the brand voice.
    let audioBytes: Buffer;
    let audioExt = 'mp3';
    if (opts.audioAssetId) {
      const [a] = await db.select().from(tables.assets).where(eq(tables.assets.id, opts.audioAssetId));
      if (!a?.driveFileId || !drive) throw new Error('audio asset unavailable');
      const dl = await drive.download(a.driveFileId);
      audioBytes = dl.bytes;
      audioExt = (a.mimeType.split('/')[1] || 'mp3').replace(/[^\w]/g, '');
    } else {
      const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, opts.productionId));
      const directed = Boolean(prod?.taggedScript);
      const text = directed ? prod!.taggedScript! : prod?.scriptText;
      if (!text) throw new Error('no voiceover and no script to synthesize');
      audioBytes = await allenSpeak(text, {
        voiceId: prod?.voiceId ?? undefined,
        modelId: directed ? 'eleven_v3' : undefined,
        stability: directed ? prod?.stability ?? 0.5 : undefined
      });
    }
    const audioPath = join(dir, `voice.${audioExt}`);
    await writeFile(audioPath, audioBytes);
    const imagePaths: string[] = [];
    for (const aid of opts.imageAssetIds) {
      const [a] = await db.select().from(tables.assets).where(eq(tables.assets.id, aid));
      if (!a?.driveFileId || !drive) continue;
      const { bytes } = await drive.download(a.driveFileId);
      const ext = (a.mimeType.split('/')[1] || 'jpg').replace(/[^\w]/g, '');
      const p = join(dir, `${a.id}.${ext}`);
      await writeFile(p, bytes);
      imagePaths.push(p);
    }
    if (imagePaths.length === 0) throw new Error('no usable images');

    // Optionally fetch free stock b-roll and interleave it with the image slides.
    const clipPaths: string[] = [];
    if (opts.broll && stock.enabled() && opts.brollQuery) {
      try {
        const clips = await stock.search(opts.brollQuery, opts.orientation, 4);
        for (const [i, c] of clips.entries()) {
          const res = await fetch(c.url);
          if (!res.ok) continue;
          const p = join(dir, `clip_${i}.mp4`);
          await writeFile(p, Buffer.from(await res.arrayBuffer()));
          clipPaths.push(p);
        }
      } catch (err) {
        app.log.warn({ err, id: videoId }, 'b-roll fetch failed (continuing with images)');
      }
    }

    // Interleave images and clips: img, clip, img, clip, …
    const segments: Segment[] = [];
    const maxLen = Math.max(imagePaths.length, clipPaths.length);
    for (let i = 0; i < maxLen; i++) {
      if (imagePaths[i]) segments.push({ type: 'image', path: imagePaths[i] });
      if (clipPaths[i]) segments.push({ type: 'video', path: clipPaths[i] });
    }

    const outPath = join(dir, 'out.mp4');
    await composeSequence({ segments, audioPath, outPath, width: opts.width, height: opts.height });
    const mp4 = await readFile(outPath);
    let driveFileId: string | null = null;
    let driveLink: string | null = null;
    if (drive && GDRIVE_VIDEO_FOLDER_ID) {
      const up = await drive.uploadBuffer({
        bytes: mp4,
        name: `custom_${videoId.slice(0, 8)}.mp4`,
        folderId: GDRIVE_VIDEO_FOLDER_ID,
        mimeType: 'video/mp4'
      });
      driveFileId = up.fileId;
      driveLink = up.webViewLink ?? null;
    }
    await db
      .update(tables.videos)
      .set({
        status: 'completed',
        driveFileId,
        driveLink,
        videoUrl: `${PUBLIC_API_BASE}/videos/${videoId}/raw`,
        updatedAt: new Date()
      })
      .where(eq(tables.videos.id, videoId));
    app.log.info({ id: videoId }, 'custom video rendered');
  } catch (err) {
    app.log.error({ err, id: videoId }, 'custom render failed');
    await db
      .update(tables.videos)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(tables.videos.id, videoId));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Whether the free stock b-roll source is configured (keys present).
app.get('/broll/status', async () => ({ enabled: stock.enabled() }));

app.post<{
  Params: { id: string };
  Body: {
    voice?: 'elevenlabs' | string;
    audioAssetId?: string;
    imageAssetIds?: string[];
    orientation?: 'portrait' | 'landscape';
    broll?: boolean;
    brollQuery?: string;
  };
}>('/productions/:id/compose', async (request, reply) => {
  if (!drive) return reply.code(503).send({ error: 'Drive not configured' });
  if (!PUBLIC_API_BASE) return reply.code(503).send({ error: 'PUBLIC_API_BASE not set' });
  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });

  const body = request.body ?? {};
  // Images: explicit list, else all the production's image assets (upload order).
  let imageAssetIds = body.imageAssetIds ?? [];
  if (imageAssetIds.length === 0) {
    const imgs = await db
      .select()
      .from(tables.assets)
      .where(and(eq(tables.assets.productionId, row.id), eq(tables.assets.kind, 'image')))
      .orderBy(tables.assets.createdAt);
    imageAssetIds = imgs.map((a) => a.id);
  }
  if (imageAssetIds.length === 0) {
    return reply.code(400).send({ error: 'no images — upload some in the Assets step first' });
  }
  // Need a voice source: an uploaded voiceover, or a script to synthesize.
  if (!body.audioAssetId && !row.scriptText && !row.taggedScript) {
    return reply.code(400).send({ error: 'no voiceover uploaded and no script to synthesize' });
  }

  const portrait = (body.orientation ?? 'portrait') === 'portrait';
  const width = portrait ? 720 : 1280;
  const height = portrait ? 1280 : 720;

  const now = new Date();
  const [video] = await db
    .insert(tables.videos)
    .values({
      id: crypto.randomUUID(),
      productionId: row.id,
      heygenVideoId: `custom-${randomUUID()}`,
      status: 'processing',
      source: 'custom',
      avatarId: '',
      inputText: (row.title || row.topic).slice(0, 200),
      title: row.title ?? null,
      brand: row.brand,
      config: {
        voice: body.audioAssetId ? 'upload' : 'elevenlabs',
        images: imageAssetIds.length,
        orientation: portrait ? 'portrait' : 'landscape',
        broll: Boolean(body.broll)
      },
      createdAt: now,
      updatedAt: now
    })
    .returning();

  // Render in the background (audio synth + ffmpeg); the dashboard polls the row.
  const brollQuery = (body.brollQuery || row.topic || row.title || '').slice(0, 80);
  void renderCustomVideo(video.id, {
    productionId: row.id,
    imageAssetIds,
    audioAssetId: body.audioAssetId,
    broll: Boolean(body.broll),
    brollQuery,
    orientation: portrait ? 'portrait' : 'landscape',
    width,
    height
  });
  return reply.code(201).send(video);
});

// Stream a stored video's bytes from Drive (custom renders live only in Drive).
app.get<{ Params: { id: string } }>('/videos/:id/raw', async (request, reply) => {
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.id, request.params.id));
  if (!row || !row.driveFileId) return reply.code(404).send({ error: 'video not found' });
  if (!drive) return reply.code(503).send({ error: 'Drive not configured' });
  try {
    const { bytes, mimeType } = await drive.download(row.driveFileId);
    reply.header('Content-Type', mimeType || 'video/mp4');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(bytes);
  } catch (err) {
    return reply.code(502).send({ error: `Drive: ${(err as Error).message}` });
  }
});

// Render the brand voice (directed if available) or read an uploaded voiceover,
// host it in Drive, and return a public URL HeyGen/etc. can fetch.
async function hostVoiceTrack(
  prod: typeof tables.productions.$inferSelect,
  audioAssetId: string | undefined,
  stabilityMode: string | undefined
): Promise<string> {
  let bytes: Buffer;
  if (audioAssetId) {
    const [a] = await db.select().from(tables.assets).where(eq(tables.assets.id, audioAssetId));
    if (!a?.driveFileId || !drive) throw new Error('audio asset unavailable');
    bytes = (await drive.download(a.driveFileId)).bytes;
  } else {
    const directed = Boolean(prod.taggedScript);
    const text = directed ? prod.taggedScript! : prod.scriptText;
    if (!text) throw new Error('no voiceover and no script to synthesize');
    const stability = directed
      ? (stabilityMode && STABILITY[stabilityMode] != null ? STABILITY[stabilityMode] : prod.stability ?? 0.5)
      : undefined;
    bytes = await allenSpeak(text, {
      voiceId: prod.voiceId ?? undefined,
      modelId: directed ? 'eleven_v3' : undefined,
      stability
    });
  }
  const up = await drive!.uploadBuffer({
    bytes,
    name: `${prod.id.slice(0, 8)}_voice.mp3`,
    folderId: GDRIVE_AUDIO_FOLDER_ID,
    mimeType: 'audio/mpeg'
  });
  const [asset] = await db
    .insert(tables.assets)
    .values({
      id: crypto.randomUUID(),
      productionId: prod.id,
      kind: 'audio',
      role: 'generated',
      fileName: 'voice.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: String(bytes.length),
      driveFileId: up.fileId,
      driveLink: up.webViewLink ?? null,
      status: 'stored',
      createdAt: new Date()
    })
    .returning();
  return `${PUBLIC_API_BASE}/assets/${asset.id}/raw`;
}

// Bytes for a stored video row — prefer the Drive copy, else fetch the source URL.
async function bytesForVideo(row: VideoRecord): Promise<Buffer | null> {
  if (row.driveFileId && drive) {
    try {
      return (await drive.download(row.driveFileId)).bytes;
    } catch {
      /* fall through to URL */
    }
  }
  if (row.videoUrl && /^https?:/.test(row.videoUrl)) {
    const res = await fetch(row.videoUrl);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

// FINAL CUT: assemble shots in the given order over the narration. Background render.
async function renderAssembly(
  videoId: string,
  opts: { productionId: string; items: Array<{ type: 'video' | 'image'; id: string }>; width: number; height: number }
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'assemble-'));
  try {
    const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, opts.productionId));
    const directed = Boolean(prod?.taggedScript);
    const text = directed ? prod!.taggedScript! : prod?.scriptText;
    if (!text) throw new Error('no script to narrate the assembly');
    const audio = await allenSpeak(text, {
      voiceId: prod?.voiceId ?? undefined,
      modelId: directed ? 'eleven_v3' : undefined,
      stability: directed ? prod?.stability ?? 0.5 : undefined
    });
    const audioPath = join(dir, 'narration.mp3');
    await writeFile(audioPath, audio);

    const segments: Segment[] = [];
    for (const [i, it] of opts.items.entries()) {
      if (it.type === 'image') {
        const [a] = await db.select().from(tables.assets).where(eq(tables.assets.id, it.id));
        if (!a?.driveFileId || !drive) continue;
        const bytes = (await drive.download(a.driveFileId)).bytes;
        const ext = (a.mimeType.split('/')[1] || 'jpg').replace(/[^\w]/g, '');
        const p = join(dir, `seg_${i}.${ext}`);
        await writeFile(p, bytes);
        segments.push({ type: 'image', path: p });
      } else {
        const [v] = await db.select().from(tables.videos).where(eq(tables.videos.id, it.id));
        if (!v) continue;
        const bytes = await bytesForVideo(v);
        if (!bytes) continue;
        const p = join(dir, `seg_${i}.mp4`);
        await writeFile(p, bytes);
        segments.push({ type: 'video', path: p });
      }
    }
    if (segments.length === 0) throw new Error('no usable shots in the order');

    const outPath = join(dir, 'final.mp4');
    await composeSequence({ segments, audioPath, outPath, width: opts.width, height: opts.height });
    const mp4 = await readFile(outPath);
    let driveFileId: string | null = null;
    let driveLink: string | null = null;
    if (drive && GDRIVE_VIDEO_FOLDER_ID) {
      const up = await drive.uploadBuffer({
        bytes: mp4,
        name: `final_${videoId.slice(0, 8)}.mp4`,
        folderId: GDRIVE_VIDEO_FOLDER_ID,
        mimeType: 'video/mp4'
      });
      driveFileId = up.fileId;
      driveLink = up.webViewLink ?? null;
    }
    await db
      .update(tables.videos)
      .set({ status: 'completed', driveFileId, driveLink, videoUrl: `${PUBLIC_API_BASE}/videos/${videoId}/raw`, updatedAt: new Date() })
      .where(eq(tables.videos.id, videoId));
  } catch (err) {
    app.log.error({ err, id: videoId }, 'assembly failed');
    await db.update(tables.videos).set({ status: 'failed', updatedAt: new Date() }).where(eq(tables.videos.id, videoId));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

app.post<{
  Params: { id: string };
  Body: { items?: Array<{ type: 'video' | 'image'; id: string }>; orientation?: 'portrait' | 'landscape' };
}>('/productions/:id/assemble', async (request, reply) => {
  if (!drive || !PUBLIC_API_BASE) return reply.code(503).send({ error: 'Drive + PUBLIC_API_BASE required' });
  const [row] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });
  const items = (request.body?.items ?? []).filter((i) => i && i.id && (i.type === 'video' || i.type === 'image'));
  if (items.length === 0) return reply.code(400).send({ error: 'order is empty — line up at least one shot' });
  if (!row.scriptText && !row.taggedScript) return reply.code(400).send({ error: 'no script to narrate' });

  const portrait = (request.body?.orientation ?? 'portrait') === 'portrait';
  const width = portrait ? 720 : 1280;
  const height = portrait ? 1280 : 720;

  const now = new Date();
  const [video] = await db
    .insert(tables.videos)
    .values({
      id: crypto.randomUUID(),
      productionId: row.id,
      heygenVideoId: `final-${randomUUID()}`,
      status: 'processing',
      source: 'final',
      avatarId: '',
      inputText: (row.title || row.topic).slice(0, 200),
      title: row.title ?? null,
      brand: row.brand,
      config: { shots: items.length, orientation: portrait ? 'portrait' : 'landscape' },
      createdAt: now,
      updatedAt: now
    })
    .returning();
  void renderAssembly(video.id, { productionId: row.id, items, width, height });
  return reply.code(201).send(video);
});

// A-ROLL: lip-sync the operator's OWN photo (HeyGen Talking Photo) to their voice.
// This is the standalone hero video.
app.post<{
  Params: { id: string };
  Body: { imageAssetId?: string; audioAssetId?: string; orientation?: 'portrait' | 'landscape'; stabilityMode?: string };
}>('/productions/:id/aroll', async (request, reply) => {
  const client = withHeyGen(reply);
  if (!client) return reply;
  if (!drive || !GDRIVE_AUDIO_FOLDER_ID || !PUBLIC_API_BASE) {
    return reply.code(503).send({ error: 'Audio hosting not configured (Drive + GDRIVE_AUDIO_FOLDER_ID + PUBLIC_API_BASE)' });
  }
  const { imageAssetId, audioAssetId, orientation, stabilityMode } = request.body ?? {};
  if (!imageAssetId) return reply.code(400).send({ error: 'imageAssetId (your photo) is required' });

  const [row] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });
  const [img] = await db.select().from(tables.assets).where(eq(tables.assets.id, imageAssetId));
  if (!img?.driveFileId) return reply.code(404).send({ error: 'image asset not found' });

  try {
    const audioUrl = await hostVoiceTrack(row, audioAssetId, stabilityMode);
    const { bytes } = await drive.download(img.driveFileId);
    const talkingPhotoId = await client.uploadTalkingPhoto(bytes, img.mimeType || 'image/jpeg');
    const portrait = (orientation ?? 'portrait') === 'portrait';
    const dim = portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 };

    return await heygenHandler(reply, async () => {
      const { videoId } = await client.generateVideo({ talkingPhotoId, audioUrl, dimension: dim, title: row.title ?? undefined });
      const now = new Date();
      const [video] = await db
        .insert(tables.videos)
        .values({
          id: crypto.randomUUID(),
          productionId: row.id,
          heygenVideoId: videoId,
          status: 'processing',
          source: 'heygen',
          avatarId: '',
          inputText: (row.title || row.topic).slice(0, 200),
          title: row.title ?? null,
          brand: row.brand,
          config: { aroll: true, imageAssetId, voice: audioAssetId ? 'upload' : 'elevenlabs', orientation: portrait ? 'portrait' : 'landscape' },
          createdAt: now,
          updatedAt: now
        })
        .returning();
      await db.update(tables.productions).set({ stage: 'generate', updatedAt: now }).where(eq(tables.productions.id, row.id));
      reply.code(201);
      return video;
    });
  } catch (err) {
    return reply.code(502).send({ error: `A-Roll failed: ${(err as Error).message}` });
  }
});

// Naive keyword extraction from a transcript for stock b-roll search.
const STOPWORDS = new Set(
  ('the a an and or but to of in on for with is are was were it this that you your i we they he she as at by be will can do not have has what when how why their our my me your yours from into about over under out up down so if then than them his her its do does did just like get got make made take used using need want know see look come back over more most very much many few all any one two'.split(
    ' '
  ))
);
function keywordsFrom(text: string, max = 5): string {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    if (!STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map((e) => e[0]).join(' ');
}

// STOCK B-ROLL: pull free clips (Pexels + Pixabay) by transcript keywords; each
// becomes a b-roll asset in the production's bin.
app.post<{ Params: { id: string }; Body: { query?: string; orientation?: 'portrait' | 'landscape' } }>(
  '/productions/:id/broll',
  async (request, reply) => {
    if (!stock.enabled()) return reply.code(503).send({ error: 'Stock b-roll not configured (set PEXELS_API_KEY / PIXABAY_API_KEY)' });
    const [row] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
    if (!row) return reply.code(404).send({ error: 'production not found' });
    const q =
      (request.body?.query || '').trim() ||
      keywordsFrom(row.taggedScript || row.scriptText || '') ||
      row.topic ||
      row.brand;
    const orientation = request.body?.orientation ?? 'portrait';
    try {
      const clips = await stock.search(q, orientation, 6);
      const now = new Date();
      const rows = [];
      for (const c of clips) {
        const [v] = await db
          .insert(tables.videos)
          .values({
            id: crypto.randomUUID(),
            productionId: row.id,
            heygenVideoId: `stock-${randomUUID()}`,
            status: 'completed',
            source: 'stock',
            avatarId: '',
            inputText: q,
            title: `${c.source} · ${q}`,
            brand: row.brand,
            videoUrl: c.url,
            config: { source: c.source, query: q },
            createdAt: now,
            updatedAt: now
          })
          .returning();
        rows.push(v);
      }
      return reply.code(201).send({ query: q, clips: rows });
    } catch (err) {
      return reply.code(502).send({ error: `stock b-roll failed: ${(err as Error).message}` });
    }
  }
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
