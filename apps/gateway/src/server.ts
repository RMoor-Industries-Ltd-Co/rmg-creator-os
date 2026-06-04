// apps/gateway/src/server.ts
// The RMG Creator OS control plane: orchestrator API the dashboard talks to.

import cors from '@fastify/cors';
import { allenConfigured, allenDraft, allenSpeak } from './allen.js';
import { createDb, desc, eq, runMigrations, tables } from '@rmg-creator-os/db';
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

// Hear the script in the brand voice (proxies ALLEN /speak → audio).
app.post<{ Params: { id: string } }>('/productions/:id/speak', async (request, reply) => {
  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });
  if (!row.scriptText) return reply.code(400).send({ error: 'no script to speak' });
  try {
    const audio = await allenSpeak(row.scriptText);
    reply.header('Content-Type', 'audio/mpeg');
    return reply.send(audio);
  } catch (err) {
    return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
  }
});

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
