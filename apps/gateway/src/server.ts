// apps/gateway/src/server.ts
// The RMG Creator OS control plane: orchestrator API the dashboard talks to.

import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import {
  allenChat,
  allenConfigured,
  allenDirect,
  allenDraft,
  allenEmotionProfiles,
  allenListen,
  allenMeeting,
  allenMetadata,
  allenSpeak,
  allenTopics,
  type AllenChatMessage
} from './allen.js';
import { brandTrends, ensureDefaultFeeds, trendContext, type TrendItem } from './feeds.js';
import { BRAND_QUERY, outliers as ytOutliers, youtubeConfigured } from './youtube.js';
import {
  createPost as postizCreatePost,
  listIntegrations as postizListIntegrations,
  matchIntegration,
  postizConfigured,
  uploadFromUrl as postizUploadFromUrl,
  type PostizPostInput
} from './postiz.js';
import { and, createDb, desc, eq, enqueueJob, runMigrations, sql, tables } from '@rmg-creator-os/db';
import {
  createDriveClient,
  createHeyGenClient,
  createHiggsfieldClient,
  createStockClient,
  HeyGenError
} from '@rmg-creator-os/integrations';
import type { HealthResponse, JobInput } from '@rmg-creator-os/types';
import { BRANDS } from '@rmg-creator-os/types';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeSequence, type Segment } from './compose.js';
import { registerWorkerRoutes } from './worker.js';
import { registerQueueRoutes } from './routes/queue.js';
import { registerDeliveryRoutes } from './routes/delivery.js';
import { registerAtelierBrollRoutes } from './routes/atelier_broll.js';
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
const GDRIVE_BROLL_FOLDER_ID = process.env.GDRIVE_BROLL_FOLDER_ID ?? '';
const GDRIVE_PROMPTS_FOLDER_ID = process.env.GDRIVE_PROMPTS_FOLDER_ID ?? '';
const GDRIVE_PERSONA_PROMPTS_FOLDER_ID = process.env.GDRIVE_PERSONA_PROMPTS_FOLDER_ID ?? '';
const GDRIVE_LIBRARY_FOLDER_ID = process.env.GDRIVE_LIBRARY_FOLDER_ID ?? '';
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
await app.register(cors, { origin: true, credentials: true });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB/file

// --- Auth (single-user Google sign-in; env-gated, off until configured) ------
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const AUTH_ALLOWED_EMAIL = (process.env.AUTH_ALLOWED_EMAIL ?? '').toLowerCase();
const COOKIE_SECRET = process.env.COOKIE_SECRET ?? 'rmg-dev-secret-change-me';
const SESSION_COOKIE = 'rmg_sess';
await app.register(cookie, { secret: COOKIE_SECRET });

// Routes that must stay public even when auth is on: health, the auth flow itself,
// and the media proxies that HeyGen/SuperCool fetch by unguessable UUID.
function isPublicRoute(method: string, url: string): boolean {
  const path = url.split('?')[0];
  if (method === 'OPTIONS') return true;
  if (path === '/health' || path.startsWith('/auth/')) return true;
  if (/^\/(assets|videos)\/[^/]+\/raw$/.test(path)) return true;
  if (path.startsWith('/assets/drive-thumb/')) return true;
  return false;
}

if (AUTH_ENABLED) {
  app.addHook('onRequest', async (request, reply) => {
    if (isPublicRoute(request.method, request.url)) return;
    const raw = request.cookies?.[SESSION_COOKIE];
    const un = raw ? request.unsignCookie(raw) : null;
    if (!un?.valid || un.value.toLowerCase() !== AUTH_ALLOWED_EMAIL) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
}

// What the dashboard needs to render the right login state.
app.get('/auth/config', async () => ({
  enabled: AUTH_ENABLED && Boolean(GOOGLE_CLIENT_ID),
  clientId: GOOGLE_CLIENT_ID
}));

// Verify a Google ID token (One Tap / button), check the allow-list, set a session.
app.post<{ Body: { credential?: string } }>('/auth/google', async (request, reply) => {
  const credential = request.body?.credential;
  if (!credential) return reply.code(400).send({ error: 'missing credential' });
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!res.ok) return reply.code(401).send({ error: 'invalid token' });
    const t = (await res.json()) as { aud?: string; email?: string; email_verified?: string };
    if (t.aud !== GOOGLE_CLIENT_ID) return reply.code(401).send({ error: 'wrong audience' });
    if (t.email_verified !== 'true' || !t.email) return reply.code(401).send({ error: 'email not verified' });
    if (t.email.toLowerCase() !== AUTH_ALLOWED_EMAIL) return reply.code(403).send({ error: 'not authorized' });
    reply.setCookie(SESSION_COOKIE, t.email.toLowerCase(), {
      signed: true,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30
    });
    return { email: t.email };
  } catch (err) {
    return reply.code(502).send({ error: `auth error: ${(err as Error).message}` });
  }
});

app.get('/auth/me', async (request, reply) => {
  const raw = request.cookies?.[SESSION_COOKIE];
  const un = raw ? request.unsignCookie(raw) : null;
  if (!un?.valid) return reply.code(401).send({ error: 'unauthorized' });
  return { email: un.value };
});

app.post('/auth/logout', async (_request, reply) => {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
});

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
  const checks: Record<string, 'ok' | 'fail' | 'unconfigured'> = {};
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
  // Integration availability (key-configured check, not a live API ping).
  checks.heygen = heygen ? 'ok' : 'fail';
  checks.higgsfield = higgs ? 'ok' : 'fail';
  checks.drive = drive ? 'ok' : 'fail';
  // ALLEN health proxy — inspect llm/tts/stt sub-checks, not just HTTP 200.
  try {
    const allenRes = await fetch('http://allen:8090/health', { signal: AbortSignal.timeout(3000) });
    if (!allenRes.ok) {
      checks.allen = 'fail';
    } else {
      const allenJson = (await allenRes.json().catch(() => null)) as null | { checks?: Record<string, string> };
      const llm = allenJson?.checks?.llm;
      checks.allen = llm === 'ok' ? 'ok' : (llm === 'unconfigured' ? 'unconfigured' : 'fail');
    }
  } catch {
    checks.allen = 'fail';
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

  // Pull recent approved (voice-directed) scripts for this brand as style memory.
  const styleRows = await db
    .select({ scriptText: tables.productions.scriptText })
    .from(tables.productions)
    .where(and(eq(tables.productions.brand, brand), sql`${tables.productions.taggedScript} IS NOT NULL`))
    .orderBy(desc(tables.productions.updatedAt))
    .limit(3);
  const brandExamples = styleRows.map((r) => r.scriptText).filter((t): t is string => Boolean(t));

  let draft;
  try {
    draft = await allenDraft({
      brand,
      topic,
      persona,
      output_kind: outputKind ?? 'post',
      allie_context: context,
      write_doc: true,
      brand_examples: brandExamples.length ? brandExamples : undefined
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

// Update script text (manual paste / edit).
app.patch<{ Params: { id: string }; Body: { scriptText: string } }>(
  '/productions/:id/script',
  async (request, reply) => {
    const { scriptText } = request.body ?? {};
    if (typeof scriptText !== 'string') return reply.code(400).send({ error: 'scriptText required' });
    const [row] = await db
      .update(tables.productions)
      .set({ scriptText, scriptStatus: 'draft', updatedAt: new Date() })
      .where(eq(tables.productions.id, request.params.id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'production not found' });
    return row;
  }
);

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
// Persists the tagged script + stability so the render can use ElevenLabs.
// version: 'v3' (bracket tags + caps, default) or 'v2' (caps + punctuation only).
// Pass { lock: true } to lock the settings in and advance the stage.
app.post<{
  Params: { id: string };
  Body: {
    voiceBrand?: string;
    intensity?: string;
    stabilityMode?: string;
    lock?: boolean;
    version?: 'v2' | 'v3';
  };
}>('/productions/:id/direct', async (request, reply) => {
  if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured (set ALLEN_URL)' });
  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });
  if (!row.scriptText) return reply.code(400).send({ error: 'no script to direct' });

  const { voiceBrand, intensity, stabilityMode, lock, version } = request.body ?? {};
  const brand = voiceBrand || row.brand;
  const targetVersion: 'v2' | 'v3' = version === 'v2' ? 'v2' : 'v3';
  const taggedColumn = targetVersion === 'v2' ? tables.productions.taggedScriptV2 : tables.productions.taggedScript;

  // Pull previously tagged scripts for this brand + version as tagging style memory.
  const taggedRows = await db
    .select({ taggedScript: taggedColumn })
    .from(tables.productions)
    .where(
      and(
        eq(tables.productions.brand, brand),
        sql`${taggedColumn} IS NOT NULL`,
        sql`${tables.productions.id} != ${request.params.id}`
      )
    )
    .orderBy(desc(tables.productions.updatedAt))
    .limit(3);
  const taggedExamples = taggedRows.map((r) => r.taggedScript).filter((t): t is string => Boolean(t));

  let result;
  try {
    result = await allenDirect({
      script: row.scriptText,
      brand,
      persona: row.persona ?? undefined,
      intensity: intensity ?? undefined,
      stability_mode: stabilityMode ?? undefined,
      brand_examples: taggedExamples.length ? taggedExamples : undefined,
      version: targetVersion
    });
  } catch (err) {
    return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
  }

  const [updated] = await db
    .update(tables.productions)
    .set({
      voiceBrand: brand,
      ...(targetVersion === 'v2' ? { taggedScriptV2: result.tagged_script } : { taggedScript: result.tagged_script }),
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

// Save manual edits to a tagged (enhanced) script version, made in the RTE-lite editor.
app.patch<{
  Params: { id: string };
  Body: { version: 'v2' | 'v3'; taggedScript: string };
}>('/productions/:id/tagged-script', async (request, reply) => {
  const { version, taggedScript } = request.body ?? ({} as { version?: string; taggedScript?: string });
  if (version !== 'v2' && version !== 'v3') return reply.code(400).send({ error: "version must be 'v2' or 'v3'" });
  if (typeof taggedScript !== 'string') return reply.code(400).send({ error: 'taggedScript required' });
  const [row] = await db
    .update(tables.productions)
    .set({
      ...(version === 'v2' ? { taggedScriptV2: taggedScript } : { taggedScript }),
      updatedAt: new Date()
    })
    .where(eq(tables.productions.id, request.params.id))
    .returning();
  if (!row) return reply.code(404).send({ error: 'production not found' });
  return row;
});

// Hear the script in the brand voice (proxies ALLEN /speak, persists the render as a
// downloadable asset, and — when a version is given — overwrites that version's take
// pointer so every regenerate is a new persistent "take," one slot per version).
// { directed: true, version: 'v2' | 'v3' } renders the matching tagged script + model.
// `text`, if given, overrides the stored tagged script — lets Generate re-process
// whatever is currently in the editor, including unsaved edits.
app.post<{
  Params: { id: string };
  Body: { directed?: boolean; stabilityMode?: string; version?: 'v2' | 'v3'; text?: string };
}>('/productions/:id/speak', async (request, reply) => {
  if (!drive || !GDRIVE_AUDIO_FOLDER_ID) {
    return reply.code(503).send({ error: 'Audio storage not configured (set GDRIVE_AUDIO_FOLDER_ID)' });
  }
  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });
  const { directed, stabilityMode, version, text: textOverride } = request.body ?? {};

  const targetVersion: 'v2' | 'v3' | undefined = version === 'v2' || version === 'v3' ? version : undefined;
  const storedTagged = targetVersion === 'v2' ? row.taggedScriptV2 : row.taggedScript;
  const useDirected = Boolean(directed && (textOverride || storedTagged));
  const text = textOverride ?? (useDirected ? storedTagged! : row.scriptText);
  if (!text) return reply.code(400).send({ error: 'no script to speak' });

  const STABILITY: Record<string, number> = { creative: 0.0, natural: 0.5, robust: 1.0 };
  const stability = useDirected
    ? (stabilityMode ? STABILITY[stabilityMode] : undefined) ?? row.stability ?? 0.5
    : undefined;
  const modelId = useDirected ? (targetVersion === 'v2' ? 'eleven_multilingual_v2' : 'eleven_v3') : undefined;

  try {
    const audio = await allenSpeak(text, {
      voiceId: row.voiceId ?? undefined,
      modelId,
      stability
    });

    const base = (row.title || row.topic).slice(0, 40).replace(/[^\w.-]+/g, '_');
    const suffix = targetVersion ? `_${targetVersion}` : '';
    const { fileId, webViewLink } = await drive.uploadBuffer({
      bytes: audio,
      name: `${row.id.slice(0, 8)}_${base}${suffix}.mp3`,
      folderId: GDRIVE_AUDIO_FOLDER_ID,
      mimeType: 'audio/mpeg'
    });
    const [asset] = await db
      .insert(tables.assets)
      .values({
        id: crypto.randomUUID(),
        productionId: row.id,
        kind: 'audio',
        role: 'generated',
        fileName: `${base}${suffix}.mp3`,
        mimeType: 'audio/mpeg',
        sizeBytes: String(audio.length),
        driveFileId: fileId,
        driveLink: webViewLink ?? null,
        status: 'stored',
        createdAt: new Date()
      })
      .returning();

    if (targetVersion) {
      await db
        .update(tables.productions)
        .set({
          ...(targetVersion === 'v2' ? { voiceTakeAssetIdV2: asset.id } : { voiceTakeAssetIdV3: asset.id }),
          updatedAt: new Date()
        })
        .where(eq(tables.productions.id, row.id));
    }

    return { assetId: asset.id };
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

// Stream a Drive file by ID directly — used for cover thumbnails in the My Poster step.
app.get<{ Params: { fileId: string } }>('/assets/drive-thumb/:fileId', async (request, reply) => {
  if (!drive) return reply.code(503).send({ error: 'Drive not configured' });
  try {
    const { bytes, mimeType } = await drive.download(request.params.fileId);
    reply.header('Content-Type', mimeType || 'image/jpeg');
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

// List the central brand-asset library (a shared Drive folder).
app.get('/assets/library', async (_request, reply) => {
  if (!drive) return reply.code(503).send({ error: 'Drive not configured' });
  if (!GDRIVE_LIBRARY_FOLDER_ID) return reply.code(503).send({ error: 'Library not configured (set GDRIVE_LIBRARY_FOLDER_ID)' });
  try {
    const files = await drive.listFolder(GDRIVE_LIBRARY_FOLDER_ID);
    return files.filter((f) => !f.mimeType.includes('folder'));
  } catch (err) {
    return reply.code(502).send({ error: `Drive: ${(err as Error).message}` });
  }
});

// Attach a library file to a production (creates an asset DB row, no upload needed).
app.post<{
  Params: { id: string };
  Body: { driveFileId: string; fileName: string; mimeType: string };
}>('/productions/:id/assets/attach', async (request, reply) => {
  const { driveFileId, fileName, mimeType } = request.body;
  if (!driveFileId || !fileName) return reply.code(400).send({ error: 'driveFileId and fileName required' });
  const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
  if (!prod) return reply.code(404).send({ error: 'production not found' });
  const [row] = await db
    .insert(tables.assets)
    .values({
      id: crypto.randomUUID(),
      productionId: prod.id,
      kind: kindFor(mimeType ?? 'application/octet-stream'),
      role: 'source',
      fileName,
      mimeType: mimeType ?? 'application/octet-stream',
      sizeBytes: '0',
      driveFileId,
      driveLink: null,
      status: 'stored',
      createdAt: new Date()
    })
    .returning();
  return reply.code(201).send(row);
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

  // Voice: prefer the operator-approved take (never overwritten); otherwise the directed
  // script is synthesized as a fallback (both handled by hostVoiceTrack).
  const directed = Boolean(row.taggedScript);
  const text = directed ? row.taggedScript! : row.scriptText;
  const hasTake = Boolean(row.voiceTakeAssetIdV3 || row.voiceTakeAssetIdV2);
  if (!text && !hasTake) return reply.code(400).send({ error: 'no script or voice take to generate from' });

  try {
    // 1) Resolve the voice audio URL — approved take served verbatim, else synthesized fallback.
    const audioUrl = await hostVoiceTrack(row, undefined, stabilityMode);

    // 2) Lip-sync the avatar to that audio.
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
          inputText: (text ?? '').slice(0, 2000),
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

/// Available generation models (default: image).
app.get<{ Querystring: { type?: 'image' | 'video' } }>('/higgsfield/models', async (request, reply) => {
  const client = withHiggs(reply);
  if (!client) return reply;
  try {
    return await client.listModels(request.query.type ?? 'image');
  } catch (err) {
    return reply.code(502).send({ error: `Higgsfield: ${(err as Error).message}` });
  }
});

// Per-model capability schema — which params does this model accept?
app.get<{ Params: { model: string } }>('/higgsfield/models/:model/schema', async (request, reply) => {
  const client = withHiggs(reply);
  if (!client) return reply;
  try {
    return await client.getModelSchema(request.params.model);
  } catch (err) {
    return reply.code(502).send({ error: `Higgsfield: ${(err as Error).message}` });
  }
});

// Persist Higgsfield multi-scene compositions and asset shortlist to DB.
app.patch<{
  Params: { id: string };
  Body: { scenes?: unknown[]; shortlist?: string[] };
}>('/productions/:id/higgsfield-scenes', async (request, reply) => {
  const { scenes, shortlist } = request.body ?? {};
  await db.update(tables.productions)
    .set({
      higgsfieldScenes: (scenes ?? []) as Record<string, unknown>[],
      higgsfieldShortlist: (shortlist ?? []) as string[],
      updatedAt: new Date()
    })
    .where(eq(tables.productions.id, request.params.id));
  return reply.send({ ok: true });
});

// Generate imagery for a production (optionally from an uploaded source image).
app.post<{
  Params: { id: string };
  Body: { prompt?: string; model?: string; sourceAssetIds?: string[]; sceneId?: string };
}>('/productions/:id/higgsfield', async (request, reply) => {
  const client = withHiggs(reply);
  if (!client) return reply;
  const { prompt, model, sourceAssetIds, sceneId } = request.body ?? {};
  if (!prompt) return reply.code(400).send({ error: 'prompt is required' });

  const MAX_SOURCE_IMAGES = 4;
  const ids = (sourceAssetIds ?? []).slice(0, MAX_SOURCE_IMAGES);

  const [row] = await db
    .select()
    .from(tables.productions)
    .where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });

  // If a Character (Higgsfield Soul) is bound to this production, condition generation on its
  // soul_id and default to its Soul-capable model — this is what keeps the character consistent
  // across every scene (B-Roll) it appears in, instead of drifting loose reference images.
  let soulId: string | undefined;
  let character: typeof tables.characters.$inferSelect | undefined;
  if (row.characterId) {
    [character] = await db.select().from(tables.characters).where(eq(tables.characters.id, row.characterId));
    soulId = character?.soulId ?? undefined;
  }
  const effectiveModel = model ?? character?.soulModel;
  if (!effectiveModel) {
    return reply.code(400).send({ error: 'model is required (or bind a Character with a soul model)' });
  }

  // Pull each source image down to a temp file.
  const imagePaths: string[] = [];
  if (ids.length > 0) {
    if (!drive) return reply.code(503).send({ error: 'Drive not configured' });
    for (const assetId of ids) {
      const [asset] = await db.select().from(tables.assets).where(eq(tables.assets.id, assetId));
      if (!asset || !asset.driveFileId) return reply.code(404).send({ error: `source asset not found: ${assetId}` });
      try {
        const { bytes } = await drive.download(asset.driveFileId);
        const ext = (asset.mimeType.split('/')[1] || 'png').replace(/[^\w]/g, '');
        const p = join(tmpdir(), `hf_${randomUUID()}.${ext}`);
        await writeFile(p, bytes);
        imagePaths.push(p);
      } catch (err) {
        return reply.code(502).send({ error: `source download failed: ${(err as Error).message}` });
      }
    }
  }

  try {
    const { jobId } = await client.createJob({ model: effectiveModel, prompt, imagePaths: imagePaths.length ? imagePaths : undefined, soulId });
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
        config: { model: effectiveModel, prompt, sourceAssetIds: ids, sceneId: sceneId ?? null, soulId: soulId ?? null, characterId: row.characterId ?? null },
        createdAt: now,
        updatedAt: now
      })
      .returning();
    return reply.code(201).send(video);
  } catch (err) {
    return reply.code(502).send({ error: `Higgsfield generate failed: ${(err as Error).message}` });
  }
});

// --- Higgsfield Souls (trained identities on the authenticated account) -------
app.get('/higgsfield/souls', async (_request, reply) => {
  const client = withHiggs(reply);
  if (!client) return reply;
  try {
    return await client.listSouls();
  } catch (err) {
    return reply.code(502).send({ error: `Higgsfield: ${(err as Error).message}` });
  }
});

// --- Characters (reusable Soul-backed identities) ----------------------------
app.get<{ Querystring: { brand?: string } }>('/characters', async (request) => {
  const { brand } = request.query ?? {};
  return brand
    ? await db
        .select()
        .from(tables.characters)
        .where(eq(tables.characters.brand, brand))
        .orderBy(desc(tables.characters.createdAt))
    : await db.select().from(tables.characters).orderBy(desc(tables.characters.createdAt));
});

app.get<{ Params: { id: string } }>('/characters/:id', async (request, reply) => {
  const [row] = await db.select().from(tables.characters).where(eq(tables.characters.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'character not found' });
  return row;
});

app.post<{
  Body: {
    name?: string;
    brand?: string;
    soulId?: string;
    soulModel?: string;
    portraitAssetId?: string;
    referenceAssetIds?: string[];
  };
}>('/characters', async (request, reply) => {
  const { name, brand, soulId, soulModel, portraitAssetId, referenceAssetIds } = request.body ?? {};
  if (!name || !brand) return reply.code(400).send({ error: 'name and brand are required' });
  const now = new Date();
  const [row] = await db
    .insert(tables.characters)
    .values({
      id: crypto.randomUUID(),
      brand,
      name,
      soulId: soulId ?? null,
      soulModel: soulModel ?? 'soul_2',
      portraitAssetId: portraitAssetId ?? null,
      referenceAssetIds: referenceAssetIds ?? [],
      status: 'ready',
      createdAt: now,
      updatedAt: now
    })
    .returning();
  return reply.code(201).send(row);
});

// Bind (or clear, with characterId: null) the Character used for a production's Assets stage.
app.post<{ Params: { id: string }; Body: { characterId?: string | null } }>(
  '/productions/:id/character',
  async (request, reply) => {
    const { characterId } = request.body ?? {};
    if (characterId) {
      const [c] = await db.select().from(tables.characters).where(eq(tables.characters.id, characterId));
      if (!c) return reply.code(404).send({ error: 'character not found' });
    }
    await db
      .update(tables.productions)
      .set({ characterId: characterId ?? null, updatedAt: new Date() })
      .where(eq(tables.productions.id, request.params.id));
    return reply.send({ ok: true });
  }
);

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
  if (!row) return reply.code(404).send({ error: 'video not found' });
  // Named download so offsite editing (CapCut/Descript) gets meaningful filenames. Serve the
  // Drive copy when present, else proxy the provider URL (higgsfield/stock only carry videoUrl).
  const fname = `${(row.label || row.source || 'clip').replace(/[^\w.-]+/g, '_')}-${row.id.slice(0, 8)}.mp4`;
  try {
    let bytes: Buffer | null = null;
    let mimeType = 'video/mp4';
    if (row.driveFileId && drive) {
      const dl = await drive.download(row.driveFileId);
      bytes = dl.bytes;
      mimeType = dl.mimeType || mimeType;
    } else if (row.videoUrl && /^https?:/.test(row.videoUrl)) {
      const res = await fetch(row.videoUrl);
      if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
    }
    if (!bytes) return reply.code(404).send({ error: 'video bytes unavailable' });
    reply.header('Content-Type', mimeType);
    reply.header('Content-Disposition', `attachment; filename="${fname}"`);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(bytes);
  } catch (err) {
    return reply.code(502).send({ error: `video: ${(err as Error).message}` });
  }
});

// Set an operator label on a clip (used to name its download for offsite editing).
app.patch<{ Params: { id: string }; Body: { label?: string } }>('/videos/:id/label', async (request, reply) => {
  const label = (request.body?.label ?? '').toString().slice(0, 120);
  const [row] = await db
    .update(tables.videos)
    .set({ label: label || null, updatedAt: new Date() })
    .where(eq(tables.videos.id, request.params.id))
    .returning();
  if (!row) return reply.code(404).send({ error: 'video not found' });
  return row;
});

// Every generated clip for a production (all sources, not collapsed) — the download-all source.
app.get<{ Params: { id: string } }>('/productions/:id/clips', async (request) => {
  const rows = await db
    .select()
    .from(tables.videos)
    .where(eq(tables.videos.productionId, request.params.id))
    .orderBy(desc(tables.videos.createdAt));
  const KIND: Record<string, string> = {
    heygen: 'A-Roll',
    higgsfield: 'Scene',
    stock: 'Stock',
    custom: 'Custom'
  };
  return rows
    .filter((v) => v.source !== 'final' && v.status === 'completed')
    .map((v) => ({
      id: v.id,
      source: v.source,
      kind: KIND[v.source] ?? v.source,
      label: v.label ?? null,
      driveLink: v.driveLink ?? null,
      hasBytes: Boolean(v.driveFileId || v.videoUrl),
      downloadUrl: `${PUBLIC_API_BASE}/videos/${v.id}/raw`
    }));
});

// Render the brand voice (directed if available) or read an uploaded voiceover,
// host it in Drive, and return a public URL HeyGen/etc. can fetch.
async function hostVoiceTrack(
  prod: typeof tables.productions.$inferSelect,
  audioAssetId: string | undefined,
  stabilityMode: string | undefined
): Promise<string> {
  // Approved voice take exists — serve it verbatim. NEVER re-synthesize: the operator
  // approved a specific ElevenLabs v3 render in the Voice step, and v3 is non-deterministic,
  // so a fresh synth would drift. HeyGen must lip-sync to exactly the approved audio. The take
  // asset is already publicly served, so return its raw URL (nothing re-hosted or overwritten).
  if (!audioAssetId && (prod.voiceTakeAssetIdV3 || prod.voiceTakeAssetIdV2)) {
    const takeId = (prod.voiceTakeAssetIdV3 ?? prod.voiceTakeAssetIdV2)!;
    const [take] = await db.select().from(tables.assets).where(eq(tables.assets.id, takeId));
    if (take?.driveFileId) return `${PUBLIC_API_BASE}/assets/${take.id}/raw`;
  }

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

// --- Naming + archival (predictable Drive nomenclature) ----------------------
const slug = (s: string) =>
  (s || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'untitled';
const dateStamp = () => new Date().toISOString().slice(0, 10);
// Derive suggested tags from a keyword/query string (individual significant words).
const TAG_STOP = new Set(['the', 'and', 'for', 'with', 'into', 'over', 'from', 'your', 'this', 'that']);
const tagsFromQuery = (q: string): string[] =>
  [...new Set((q.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !TAG_STOP.has(w)))].slice(0, 6);
const prodBase = (p: typeof tables.productions.$inferSelect) =>
  `${(p.brand || 'RMG').toUpperCase()}__${slug(p.title || p.topic)}`;

// Save a b-roll clip into the global library with predictable name + tags.
async function saveBrollToLibrary(v: VideoRecord): Promise<VideoRecord> {
  if (!drive || !GDRIVE_BROLL_FOLDER_ID) return v;
  const cfg = (v.config ?? {}) as Record<string, unknown>;
  if (cfg.library) return v; // already in the library
  // Never save empty — derive tags from the clip's keywords if untagged.
  const tags = ((cfg.tags as string[] | undefined)?.length ? (cfg.tags as string[]) : tagsFromQuery(v.inputText || (cfg.query as string) || ''));
  const tagSlug = slug(tags.join('-') || v.inputText || 'clip');
  const name = `B-ROLL__${tagSlug}__${v.source}__${v.id.slice(0, 6)}.mp4`;
  const bytes = await bytesForVideo(v);
  if (!bytes) return v;
  const up = await drive.uploadBuffer({ bytes, name, folderId: GDRIVE_BROLL_FOLDER_ID, mimeType: 'video/mp4' });
  if (tags.length) await drive.updateFile(up.fileId, { description: `tags: ${tags.join(', ')}` }).catch(() => undefined);
  const [u] = await db
    .update(tables.videos)
    .set({ driveFileId: up.fileId, driveLink: up.webViewLink ?? null, config: { ...cfg, library: true, libraryName: name }, updatedAt: new Date() })
    .where(eq(tables.videos.id, v.id))
    .returning();
  return u;
}

// Tag a video (stored in config + written to the Drive file description for search).
app.patch<{ Params: { id: string }; Body: { tags?: string[] } }>('/videos/:id/tags', async (request, reply) => {
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'video not found' });
  const tags = (request.body?.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20);
  if (drive && row.driveFileId) {
    await drive.updateFile(row.driveFileId, { description: tags.length ? `tags: ${tags.join(', ')}` : '' }).catch(() => undefined);
  }
  const [u] = await db
    .update(tables.videos)
    .set({ config: { ...((row.config ?? {}) as Record<string, unknown>), tags }, updatedAt: new Date() })
    .where(eq(tables.videos.id, row.id))
    .returning();
  return u;
});

// Save one b-roll clip to the Drive library (button on each clip).
app.post<{ Params: { id: string } }>('/videos/:id/save-to-drive', async (request, reply) => {
  if (!drive || !GDRIVE_BROLL_FOLDER_ID) return reply.code(503).send({ error: 'B-roll library not configured' });
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'video not found' });
  try {
    return await saveBrollToLibrary(row);
  } catch (err) {
    return reply.code(502).send({ error: `save failed: ${(err as Error).message}` });
  }
});

// Gather + archive: move A-Roll + Final + Voice into a titled per-video folder
// (renamed predictably), save all b-roll to the library, return every Drive link.
app.post<{ Params: { id: string } }>('/productions/:id/archive', async (request, reply) => {
  if (!drive || !GDRIVE_VIDEO_FOLDER_ID) return reply.code(503).send({ error: 'Drive not configured' });
  const [p] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
  if (!p) return reply.code(404).send({ error: 'production not found' });

  const base = prodBase(p);
  const date = dateStamp();
  try {
    // Per-video folder (reuse if it already exists).
    const existing = (await drive.listFolder(GDRIVE_VIDEO_FOLDER_ID)).find(
      (f) => f.name === base && f.mimeType === 'application/vnd.google-apps.folder'
    );
    const folderId = existing?.id ?? (await drive.createFolder(base, GDRIVE_VIDEO_FOLDER_ID));

    const vids = await db.select().from(tables.videos).where(eq(tables.videos.productionId, p.id));
    const aroll = vids.filter((v) => v.source === 'heygen' && (v.config as { aroll?: boolean })?.aroll && v.status === 'completed').sort((a, b) => (b.approved ? 1 : 0) - (a.approved ? 1 : 0))[0];
    const final = vids.filter((v) => v.source === 'final' && v.status === 'completed').sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
    const audioAssets = await db.select().from(tables.assets).where(and(eq(tables.assets.productionId, p.id), eq(tables.assets.kind, 'audio')));
    const voice = audioAssets.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];

    const out: Record<string, unknown> = { folder: `https://drive.google.com/drive/folders/${folderId}` };

    async function move(fileId: string | null, name: string, fromFolder: string) {
      if (!fileId) return null;
      const r = await drive!.updateFile(fileId, { name, addParents: folderId, removeParents: fromFolder }).catch(() => null);
      return r?.webViewLink ?? null;
    }
    if (aroll?.driveFileId) out.aroll = { name: `${base}__A-ROLL__${date}.mp4`, link: await move(aroll.driveFileId, `${base}__A-ROLL__${date}.mp4`, GDRIVE_VIDEO_FOLDER_ID) };
    if (final?.driveFileId) out.final = { name: `${base}__FINAL__${date}.mp4`, link: await move(final.driveFileId, `${base}__FINAL__${date}.mp4`, GDRIVE_VIDEO_FOLDER_ID) };
    if (voice?.driveFileId) out.voice = { name: `${base}__VOICE__${date}.mp3`, link: await move(voice.driveFileId, `${base}__VOICE__${date}.mp3`, GDRIVE_AUDIO_FOLDER_ID) };

    // Save all b-roll (stock + scene videos) to the library.
    const broll = [];
    for (const v of vids.filter((v) => v.source === 'stock' || (v.source === 'higgsfield' && /\.(mp4|mov|webm)(\?|$)/i.test(v.videoUrl ?? '')))) {
      const saved = await saveBrollToLibrary(v).catch(() => v);
      broll.push({ id: v.id, name: (saved.config as { libraryName?: string })?.libraryName ?? null, link: saved.driveLink, tags: (saved.config as { tags?: string[] })?.tags ?? [] });
    }
    out.broll = broll;

    await db.update(tables.productions).set({ stage: 'post', updatedAt: new Date() }).where(eq(tables.productions.id, p.id));
    return out;
  } catch (err) {
    return reply.code(502).send({ error: `archive failed: ${(err as Error).message}` });
  }
});

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
        // A "video" row can actually hold a still image (e.g. a Higgsfield image
        // model). Detect by URL so ffmpeg treats it as a slide, not a clip.
        const isImg = /\.(png|jpe?g|webp)(\?|$)/i.test(v.videoUrl ?? '');
        const ext = isImg ? (v.videoUrl ?? '').toLowerCase().match(/\.(png|jpe?g|webp)/)?.[1] ?? 'png' : 'mp4';
        const p = join(dir, `seg_${i}.${ext}`);
        await writeFile(p, bytes);
        segments.push({ type: isImg ? 'image' : 'video', path: p });
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

// Read a Drive folder of prompt files (text or Docs) into [{name, text}].
async function readPromptFolder(folderId: string): Promise<Array<{ name: string; text: string }>> {
  if (!drive || !folderId) return [];
  const files = await drive.listFolder(folderId);
  const textish = files.filter(
    (f) => f.mimeType.startsWith('text/') || f.mimeType === 'application/vnd.google-apps.document'
  );
  const out = await Promise.all(
    textish.map(async (f) => ({
      name: f.name.replace(/\.(txt|md|rtf)$/i, ''),
      text: await drive!.readText(f.id, f.mimeType).catch(() => '')
    }))
  );
  return out.filter((p) => p.text).sort((a, b) => a.name.localeCompare(b.name));
}

// Prompt libraries by kind: 'motion' (A-Roll/HeyGen) | 'scene' (Higgsfield personas).
const PROMPT_FOLDERS: Record<string, string> = {
  motion: GDRIVE_PROMPTS_FOLDER_ID,
  scene: GDRIVE_PERSONA_PROMPTS_FOLDER_ID
};
app.get<{ Querystring: { kind?: string } }>('/prompts', async (request, reply) => {
  const folder = PROMPT_FOLDERS[request.query.kind ?? 'motion'];
  try {
    return await readPromptFolder(folder);
  } catch (err) {
    return reply.code(502).send({ error: `prompts: ${(err as Error).message}` });
  }
});

// Back-compat: A-Roll motion prompts.
app.get('/aroll/prompts', async (_request, reply) => {
  try {
    return await readPromptFolder(GDRIVE_PROMPTS_FOLDER_ID);
  } catch (err) {
    return reply.code(502).send({ error: `prompts: ${(err as Error).message}` });
  }
});

// A-ROLL: lip-sync the operator's OWN photo (HeyGen Talking Photo / Avatar IV) to
// their voice, guided by an optional motion prompt. This is the standalone hero.
app.post<{
  Params: { id: string };
  Body: {
    imageAssetId?: string;
    sourceVideoId?: string;
    audioAssetId?: string;
    orientation?: 'portrait' | 'landscape';
    stabilityMode?: string;
    motionPrompt?: string;
  };
}>('/productions/:id/aroll', async (request, reply) => {
  const client = withHeyGen(reply);
  if (!client) return reply;
  if (!drive || !GDRIVE_AUDIO_FOLDER_ID || !PUBLIC_API_BASE) {
    return reply.code(503).send({ error: 'Audio hosting not configured (Drive + GDRIVE_AUDIO_FOLDER_ID + PUBLIC_API_BASE)' });
  }
  const { imageAssetId, sourceVideoId, audioAssetId, orientation, stabilityMode, motionPrompt } = request.body ?? {};
  if (!imageAssetId && !sourceVideoId) {
    return reply.code(400).send({ error: 'imageAssetId or sourceVideoId (your cleaned still) is required' });
  }

  const [row] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'production not found' });

  // Source still: an uploaded image asset, or an approved cleaned still (Higgsfield video row).
  let imgBytes: Buffer | null = null;
  let imgMime = 'image/jpeg';
  if (imageAssetId) {
    const [img] = await db.select().from(tables.assets).where(eq(tables.assets.id, imageAssetId));
    if (!img?.driveFileId) return reply.code(404).send({ error: 'image asset not found' });
    imgBytes = (await drive.download(img.driveFileId)).bytes;
    imgMime = img.mimeType || 'image/jpeg';
  } else if (sourceVideoId) {
    const [v] = await db.select().from(tables.videos).where(eq(tables.videos.id, sourceVideoId));
    if (!v) return reply.code(404).send({ error: 'source still not found' });
    imgBytes = await bytesForVideo(v);
    imgMime = /\.png(\?|$)/i.test(v.videoUrl ?? '') ? 'image/png' : 'image/jpeg';
  }
  if (!imgBytes) return reply.code(400).send({ error: 'could not load the source still' });

  try {
    const audioUrl = await hostVoiceTrack(row, audioAssetId, stabilityMode);
    const talkingPhotoId = await client.uploadTalkingPhoto(imgBytes, imgMime);
    const portrait = (orientation ?? 'portrait') === 'portrait';
    const dim = portrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 };

    return await heygenHandler(reply, async () => {
      const { videoId } = await client.generateVideo({
        talkingPhotoId,
        audioUrl,
        useAvatarIv: true,
        customMotionPrompt: motionPrompt?.trim() || undefined,
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
          avatarId: '',
          inputText: (row.title || row.topic).slice(0, 200),
          title: row.title ?? null,
          brand: row.brand,
          config: { aroll: true, imageAssetId: imageAssetId ?? sourceVideoId, motionPrompt: motionPrompt ?? null, voice: audioAssetId ? 'upload' : 'elevenlabs', orientation: portrait ? 'portrait' : 'landscape' },
          createdAt: now,
          updatedAt: now
        })
        .returning();
      await db.update(tables.productions).set({ stage: 'generate', updatedAt: now }).where(eq(tables.productions.id, row.id));
      // Record in the production job queue for observability + retry tracking.
      await enqueueJob(db, {
        productionId: row.id,
        capability: 'aroll',
        provider: 'heygen',
        payload: { videoId, talkingPhotoId, audioUrl, dimension: dim, motionPrompt: motionPrompt ?? null, videoRowId: video.id },
        priority: 5,
      }).catch(() => undefined); // non-fatal — the video row is the source of truth
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
            config: { source: c.source, query: q, tags: tagsFromQuery(q) },
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
  // HeyGen render approved → ready to post.
  if (row.productionId && row.source === 'heygen') {
    await db
      .update(tables.productions)
      .set({ stage: 'post', updatedAt: new Date() })
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

// --- My Poster cockpit (Post step): brand defaults, post packages, ALLIE suggest ---

app.get<{ Params: { brand: string } }>('/brands/:brand/post-defaults', async (request) => {
  const [row] = await db
    .select()
    .from(tables.brandPostDefaults)
    .where(eq(tables.brandPostDefaults.brand, request.params.brand));
  return row ?? { brand: request.params.brand, platforms: [], hashtagStyle: null, audience: null, firstCommentTemplate: null, cadence: null };
});

app.put<{
  Params: { brand: string };
  Body: { platforms?: string[]; hashtagStyle?: string; audience?: string; firstCommentTemplate?: string; cadence?: string };
}>('/brands/:brand/post-defaults', async (request) => {
  const b = request.body ?? {};
  const values = {
    brand: request.params.brand,
    platforms: b.platforms ?? [],
    hashtagStyle: b.hashtagStyle ?? null,
    audience: b.audience ?? null,
    firstCommentTemplate: b.firstCommentTemplate ?? null,
    cadence: b.cadence ?? null,
    updatedAt: new Date()
  };
  const [row] = await db
    .insert(tables.brandPostDefaults)
    .values(values)
    .onConflictDoUpdate({ target: tables.brandPostDefaults.brand, set: values })
    .returning();
  return row;
});

app.get<{ Params: { id: string } }>('/productions/:id/posts', async (request) =>
  db.select().from(tables.posts).where(eq(tables.posts.productionId, request.params.id))
);

// Upsert one platform's post for a production.
app.put<{
  Params: { id: string; platform: string };
  Body: {
    title?: string;
    caption?: string;
    hashtags?: string[];
    firstComment?: string;
    coverAssetId?: string;
    switches?: Record<string, unknown>;
    scheduleAt?: string | null;
    status?: string;
  };
}>('/productions/:id/posts/:platform', async (request, reply) => {
  const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
  if (!prod) return reply.code(404).send({ error: 'production not found' });
  const b = request.body ?? {};
  const [existing] = await db
    .select()
    .from(tables.posts)
    .where(and(eq(tables.posts.productionId, request.params.id), eq(tables.posts.platform, request.params.platform)));
  const fields = {
    title: b.title ?? null,
    caption: b.caption ?? null,
    hashtags: b.hashtags ?? [],
    firstComment: b.firstComment ?? null,
    coverAssetId: b.coverAssetId ?? null,
    switches: b.switches ?? null,
    scheduleAt: b.scheduleAt ? new Date(b.scheduleAt) : null,
    status: b.status ?? 'draft',
    updatedAt: new Date()
  };
  if (existing) {
    const [row] = await db.update(tables.posts).set(fields).where(eq(tables.posts.id, existing.id)).returning();
    return row;
  }
  const [row] = await db
    .insert(tables.posts)
    .values({ id: crypto.randomUUID(), productionId: request.params.id, brand: prod.brand, platform: request.params.platform, createdAt: new Date(), ...fields })
    .returning();
  return reply.code(201).send(row);
});

// ALLIE: suggested next topics for a brand (front of the pipeline).
// ?trends=1 (default) grounds suggestions in current RSS/Google-News headlines.
app.get<{ Params: { brand: string }; Querystring: { count?: string; trends?: string } }>(
  '/brands/:brand/topics',
  async (request, reply) => {
    if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured' });
    const { brand } = request.params;
    const count = Math.min(12, Math.max(3, Number(request.query.count) || 6));
    const useTrends = request.query.trends !== '0';
    let trends: TrendItem[] = [];
    let context: string | undefined;
    if (useTrends) {
      try {
        trends = await brandTrends(db, brand);
        context = trendContext(trends) || undefined;
      } catch {
        /* trends are best-effort; never block suggestions */
      }
    }
    try {
      const { topics } = await allenTopics({ brand, count, context });
      return { topics, trends };
    } catch (err) {
      return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
    }
  }
);

// Social Manager (Postiz) status + connected channels.
app.get('/postiz/status', async () => {
  if (!postizConfigured()) return { configured: false, integrations: [] };
  try {
    return { configured: true, integrations: await postizListIntegrations() };
  } catch (err) {
    return { configured: true, integrations: [], error: (err as Error).message };
  }
});

// My Poster → Postiz hand-off: push the final video + per-platform metadata to the engine.
app.post<{ Params: { id: string }; Body: { platforms?: string[]; type?: 'draft' | 'schedule' | 'now'; date?: string } }>(
  '/productions/:id/publish',
  async (request, reply) => {
    if (!postizConfigured()) return reply.code(503).send({ error: 'Postiz not configured (set POSTIZ_API_KEY)' });
    if (!PUBLIC_API_BASE) return reply.code(503).send({ error: 'PUBLIC_API_BASE not set' });
    const { id } = request.params;
    const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, id));
    if (!prod) return reply.code(404).send({ error: 'production not found' });

    // The final video for this production (the rendered cut), public for Postiz to fetch.
    const vids = await db.select().from(tables.videos).where(eq(tables.videos.productionId, id));
    const completed = vids.filter((v) => v.status === 'completed');
    const finalVid =
      completed.filter((v) => v.source === 'final').sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0] ??
      completed.filter((v) => v.approved).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0] ??
      completed.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
    if (!finalVid) return reply.code(400).send({ error: 'no completed video to publish — finish the render first' });
    const mediaUrl = `${PUBLIC_API_BASE}/videos/${finalVid.id}/raw`;

    const postRows = await db.select().from(tables.posts).where(eq(tables.posts.productionId, id));
    const wanted = request.body?.platforms?.length ? request.body.platforms : postRows.map((p) => p.platform);
    if (!wanted.length) return reply.code(400).send({ error: 'no platforms selected (compose drafts first)' });

    let integrations;
    try {
      integrations = await postizListIntegrations();
    } catch (err) {
      return reply.code(502).send({ error: `Postiz: ${(err as Error).message}` });
    }

    // Build a post per connected platform.
    const built: PostizPostInput[] = [];
    const results: Array<{ platform: string; ok: boolean; channel?: string; reason?: string }> = [];
    for (const platform of wanted) {
      const integ = matchIntegration(platform, integrations);
      if (!integ) {
        results.push({ platform, ok: false, reason: 'no connected channel in Postiz' });
        continue;
      }
      const row = postRows.find((p) => p.platform === platform);
      const caption = row?.caption ?? prod.title ?? prod.topic;
      const tags = (row?.hashtags ?? []).join(' ');
      const content = [caption, tags].filter(Boolean).join('\n\n');
      built.push({ integrationId: integ.id, identifier: integ.identifier, content, media: [] });
      results.push({ platform, ok: true, channel: integ.name });
    }
    if (!built.length) return reply.code(400).send({ error: 'none of the selected platforms are connected in Postiz', results });

    const type = request.body?.type ?? 'draft';
    try {
      const media = await postizUploadFromUrl(mediaUrl);
      for (const b of built) b.media = [media];
      const postizRes = await postizCreatePost({ type, date: request.body?.date, posts: built });
      const newStatus = type === 'now' ? 'published' : type === 'draft' ? 'draft' : 'scheduled';
      for (const r of results.filter((x) => x.ok)) {
        await db
          .update(tables.posts)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(and(eq(tables.posts.productionId, id), eq(tables.posts.platform, r.platform)));
      }
      return { ok: true, type, channels: results, postiz: postizRes };
    } catch (err) {
      return reply.code(502).send({ error: `Postiz: ${(err as Error).message}`, results });
    }
  }
);

// Build ALLEN's concierge context: who he is + current system state, recent work, and memories.
async function buildConciergeContext(brand?: string): Promise<string> {
  const parts: string[] = [];
  parts.push(
    'RMG Creator OS is Rahm\'s in-house content engine. Pipeline stages in order: topic → script → voice → ' +
      'video → post → published. ' +
      'Post status meanings — draft: not yet scheduled; scheduled: queued for publish (NOT live yet); ' +
      'published: confirmed live with a postUrl; failed: publish error. ' +
      'Production stage meanings — topic: idea only; script: needs script written or reviewed; ' +
      'voice: needs voice direction; video: video rendering; final: assembled cut ready; archived: done. ' +
      'Brands: ' +
      BRANDS.filter((b) => b.contentFolder)
        .map((b) => b.code)
        .join(', ') +
      '. IMPORTANT: you have NO engagement, analytics, or social performance data — do not infer any.'
  );

  // Recent productions
  const prods = await db
    .select()
    .from(tables.productions)
    .orderBy(desc(tables.productions.updatedAt))
    .limit(8);
  if (prods.length) {
    parts.push(
      'Recent productions:\n' +
        prods
          .map((p) => `- ${p.brand}: "${p.topic}" (stage: ${p.stage}, status: ${p.status})`)
          .join('\n')
    );
  }

  // Recent posts (My Poster drafts / scheduled / published)
  const recentPosts = await db.select().from(tables.posts).orderBy(desc(tables.posts.updatedAt)).limit(10);
  if (recentPosts.length) {
    parts.push(
      'Recent posts:\n' +
        recentPosts
          .map(
            (p) =>
              `- ${p.brand} ${p.platform} [${p.status}]${p.title ? ` "${p.title}"` : p.caption ? ` "${p.caption.slice(0, 60)}"` : ''}`
          )
          .join('\n')
    );
  }

  // Recent meeting transcripts (ALLEN Transcriber)
  const trs = await db
    .select({
      title: tables.transcripts.title,
      summary: tables.transcripts.summary,
      createdAt: tables.transcripts.createdAt
    })
    .from(tables.transcripts)
    .orderBy(desc(tables.transcripts.createdAt))
    .limit(5);
  if (trs.length) {
    parts.push(
      'Recent meeting transcripts you have on file:\n' +
        trs.map((t) => `- ${t.title ?? 'Meeting'}${t.summary ? `: ${t.summary.slice(0, 200)}` : ''}`).join('\n')
    );
  }

  // Saved memories (global + this brand)
  const mems = await db
    .select()
    .from(tables.allenMemories)
    .orderBy(desc(tables.allenMemories.createdAt))
    .limit(50);
  const relevant = mems.filter((m) => !m.brand || (brand && m.brand === brand));
  if (relevant.length) {
    parts.push(
      'Saved memories (things Rahm told you to remember):\n' +
        relevant.map((m) => `- [id:${m.id}]${m.brand ? ` [${m.brand}]` : ''} ${m.content}`).join('\n')
    );
  }
  return parts.join('\n\n');
}

// Talk to ALLEN — the concierge. Enriched with system state, recent work, and memories.
app.post<{ Body: { message?: string; brand?: string; persona?: string; history?: AllenChatMessage[] } }>(
  '/allen/chat',
  async (request, reply) => {
    if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured' });
    const message = (request.body?.message ?? '').trim();
    if (!message) return reply.code(400).send({ error: 'message required' });
    try {
      const context = await buildConciergeContext(request.body?.brand);
      const { reply: raw } = await allenChat({
        message,
        brand: request.body?.brand,
        persona: request.body?.persona,
        history: (request.body?.history ?? []).slice(-8),
        context
      });
      const { reply: cleaned, memoryChanged } = await applyMemoryOps(raw);
      return { reply: cleaned, memoryChanged };
    } catch (err) {
      return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
    }
  }
);

// Parse ALLEN's @@MEMORY {...}@@ control block, run the ops, and strip it from the spoken reply.
interface MemoryOp {
  op: 'add' | 'update' | 'delete';
  id?: string;
  brand?: string | null;
  content?: string;
}
async function applyMemoryOps(reply: string): Promise<{ reply: string; memoryChanged: boolean }> {
  const m = reply.match(/@@MEMORY\s*(\{[\s\S]*?\})\s*@@/);
  const cleaned = reply.replace(/@@MEMORY[\s\S]*?@@/g, '').trim();
  if (!m) return { reply: reply.trim(), memoryChanged: false };
  let ops: MemoryOp[] = [];
  try {
    ops = (JSON.parse(m[1]) as { ops?: MemoryOp[] }).ops ?? [];
  } catch {
    return { reply: cleaned, memoryChanged: false };
  }
  let changed = false;
  for (const o of ops) {
    try {
      if (o.op === 'add' && o.content?.trim()) {
        await db.insert(tables.allenMemories).values({
          id: `mem-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
          brand: (o.brand ?? '') || null,
          content: o.content.trim(),
          source: 'allen'
        });
        changed = true;
      } else if (o.op === 'update' && o.id && o.content?.trim()) {
        const patch: { content: string; brand?: string | null } = { content: o.content.trim() };
        if (o.brand !== undefined) patch.brand = (o.brand ?? '') || null;
        await db.update(tables.allenMemories).set(patch).where(eq(tables.allenMemories.id, o.id));
        changed = true;
      } else if (o.op === 'delete' && o.id) {
        await db.delete(tables.allenMemories).where(eq(tables.allenMemories.id, o.id));
        changed = true;
      }
    } catch {
      /* skip a bad op, keep the rest */
    }
  }
  return { reply: cleaned, memoryChanged: changed };
}

// Morning brief — ALLIE preps the notes, ALLEN delivers them as a spoken greeting.
app.get<{ Querystring: { brand?: string; daypart?: string } }>('/allen/brief', async (request, reply) => {
  if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured' });
  const daypart = ['morning', 'afternoon', 'evening'].includes(request.query.daypart ?? '')
    ? request.query.daypart
    : 'day';
  const prompt =
    `It is the ${daypart} and ALLIE has prepped your notes for Rahm. Greet him warmly by name ` +
    `(he is Rahm), then give him the two to four things that genuinely deserve attention right now — drawn ` +
    `strictly from the data in your context: recent productions (by stage and status), recent posts (by ` +
    `status: draft/scheduled/published), and saved memories. ` +
    `GROUNDING RULES — you must follow these exactly: ` +
    `(1) Only say a post or video is "live" or "published" if its status field is literally "published" with a confirmed postUrl. ` +
    `(2) Never claim engagement, traction, reach, or performance data — you have no analytics; omit those phrases entirely. ` +
    `(3) Never infer or editorialize beyond what the status and stage fields tell you. ` +
    `(4) If a production is at "script" stage, say it needs a script review; if at "voice", say it needs voice direction — use the actual stage name. ` +
    `(5) If you are uncertain about a fact, skip it rather than guess. ` +
    `Speak naturally, like a partner catching him up over coffee. Keep it under 120 words, no lists or bullet syntax, just flowing speech.`;
  try {
    const context = await buildConciergeContext(request.query.brand);
    const { reply: brief } = await allenChat({ message: prompt, context });
    return { brief };
  } catch (err) {
    return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
  }
});

// ALLEN listens — transcribe an audio clip (mic input) via Whisper.
app.post('/allen/listen', async (request, reply) => {
  if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured' });
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: 'audio file required' });
  try {
    const buf = await file.toBuffer();
    return await allenListen(buf, file.filename || 'audio.webm', file.mimetype || 'audio/webm');
  } catch (err) {
    return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
  }
});

// ALLEN Transcriber — record a meeting, transcribe (Whisper), summarize, save (Postgres),
// and auto-commit the highlights to memory.
app.post<{ Querystring: { title?: string; brand?: string } }>(
  '/allen/transcribe',
  async (request, reply) => {
    if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured' });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'audio file required' });
    const brand = (request.query.brand ?? '').trim() || null;
    let transcript: string;
    try {
      const buf = await file.toBuffer();
      transcript = (await allenListen(buf, file.filename || 'meeting.webm', file.mimetype || 'audio/webm')).text;
    } catch (err) {
      return reply.code(502).send({ error: `Transcription failed: ${(err as Error).message}` });
    }
    if (!transcript.trim()) return reply.code(422).send({ error: 'no speech detected in the recording' });

    let meet = { summary: '', action_items: [] as string[], highlights: [] as string[] };
    try {
      meet = await allenMeeting({ transcript, brand: brand ?? undefined });
    } catch {
      /* keep the transcript even if summarization fails */
    }

    const now = new Date();
    const id = `tr-${now.getTime()}`;
    const title =
      (request.query.title ?? '').trim() ||
      `Meeting ${now.toISOString().slice(0, 16).replace('T', ' ')}`;
    await db.insert(tables.transcripts).values({
      id,
      title: title.slice(0, 140),
      brand,
      transcript,
      summary: meet.summary || null,
      actionItems: meet.action_items
    });
    // Auto-save highlights to ALLEN's memory.
    for (const h of meet.highlights) {
      await db.insert(tables.allenMemories).values({
        id: `mem-${now.getTime()}-${Math.floor(Math.random() * 1e4)}`,
        brand,
        content: h,
        source: 'allen'
      });
    }
    const [saved] = await db.select().from(tables.transcripts).where(eq(tables.transcripts.id, id));
    return reply.code(201).send({ transcript: saved, highlightsSaved: meet.highlights.length });
  }
);

app.get('/allen/transcripts', async () => {
  const rows = await db
    .select({
      id: tables.transcripts.id,
      title: tables.transcripts.title,
      brand: tables.transcripts.brand,
      summary: tables.transcripts.summary,
      actionItems: tables.transcripts.actionItems,
      createdAt: tables.transcripts.createdAt
    })
    .from(tables.transcripts)
    .orderBy(desc(tables.transcripts.createdAt));
  return { transcripts: rows };
});

app.get<{ Params: { id: string } }>('/allen/transcripts/:id', async (request, reply) => {
  const [row] = await db.select().from(tables.transcripts).where(eq(tables.transcripts.id, request.params.id));
  if (!row) return reply.code(404).send({ error: 'not found' });
  return row;
});

app.delete<{ Params: { id: string } }>('/allen/transcripts/:id', async (request, reply) => {
  await db.delete(tables.transcripts).where(eq(tables.transcripts.id, request.params.id));
  return reply.code(204).send();
});

// ALLEN memory / knowledge base.
app.get<{ Querystring: { brand?: string } }>('/allen/memory', async (request) => {
  const rows = await db.select().from(tables.allenMemories).orderBy(desc(tables.allenMemories.createdAt));
  const brand = request.query.brand;
  const memories = brand ? rows.filter((m) => !m.brand || m.brand === brand) : rows;
  return { memories };
});

app.post<{ Body: { content?: string; brand?: string } }>('/allen/memory', async (request, reply) => {
  const content = (request.body?.content ?? '').trim();
  if (!content) return reply.code(400).send({ error: 'content required' });
  const row = {
    id: `mem-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    brand: (request.body?.brand ?? '').trim() || null,
    content,
    source: 'user'
  };
  await db.insert(tables.allenMemories).values(row);
  return reply.code(201).send(row);
});

app.put<{ Params: { id: string }; Body: { content?: string; brand?: string | null } }>(
  '/allen/memory/:id',
  async (request, reply) => {
    const content = (request.body?.content ?? '').trim();
    if (!content) return reply.code(400).send({ error: 'content required' });
    const patch: { content: string; brand?: string | null } = { content };
    if (request.body?.brand !== undefined) patch.brand = (request.body.brand ?? '') || null;
    await db.update(tables.allenMemories).set(patch).where(eq(tables.allenMemories.id, request.params.id));
    const [row] = await db
      .select()
      .from(tables.allenMemories)
      .where(eq(tables.allenMemories.id, request.params.id));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return row;
  }
);

app.delete<{ Params: { id: string } }>('/allen/memory/:id', async (request, reply) => {
  await db.delete(tables.allenMemories).where(eq(tables.allenMemories.id, request.params.id));
  return reply.code(204).send();
});

// ALLEN speaks — generic text → ElevenLabs audio (mp3).
app.post<{ Body: { text?: string; voiceId?: string; stability?: number } }>(
  '/allen/speak',
  async (request, reply) => {
    if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured' });
    const text = (request.body?.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text required' });
    try {
      const audio = await allenSpeak(text, {
        voiceId: request.body?.voiceId,
        stability: request.body?.stability
      });
      return reply.type('audio/mpeg').send(audio);
    } catch (err) {
      return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
    }
  }
);

// ALLIE trends: the current headlines ALLIE is drawing from for a brand.
app.get<{ Params: { brand: string } }>('/brands/:brand/trends', async (request) => {
  const items = await brandTrends(db, request.params.brand);
  return { items };
});

// ALLIE Outlier Radar — YouTube videos overperforming their channel (the 1of10 signal).
app.get<{ Querystring: { brand?: string; q?: string } }>('/allie/outliers', async (request, reply) => {
  if (!youtubeConfigured()) return reply.code(503).send({ configured: false, error: 'YouTube not configured' });
  const query = (request.query.q ?? '').trim() || BRAND_QUERY[request.query.brand ?? ''] || '';
  if (!query) return reply.code(400).send({ error: 'q or a known brand is required' });
  try {
    return { configured: true, query, outliers: await ytOutliers(query) };
  } catch (err) {
    return reply.code(502).send({ error: `YouTube: ${(err as Error).message}` });
  }
});

app.get('/allie/outliers/status', async () => ({ configured: youtubeConfigured() }));

// Manage a brand's trend sources.
app.get<{ Params: { brand: string } }>('/brands/:brand/feeds', async (request) => {
  const feeds = await ensureDefaultFeeds(db, request.params.brand);
  return { feeds };
});

app.post<{ Params: { brand: string }; Body: { url?: string; title?: string } }>(
  '/brands/:brand/feeds',
  async (request, reply) => {
    const url = (request.body?.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return reply.code(400).send({ error: 'valid feed url required' });
    const row = {
      id: `${request.params.brand}-${Date.now()}`,
      brand: request.params.brand,
      url,
      title: (request.body?.title ?? '').trim() || null,
      kind: 'rss',
      enabled: true
    };
    await db.insert(tables.brandFeeds).values(row);
    return reply.code(201).send(row);
  }
);

app.delete<{ Params: { id: string } }>('/feeds/:id', async (request, reply) => {
  await db.delete(tables.brandFeeds).where(eq(tables.brandFeeds.id, request.params.id));
  return reply.code(204).send();
});

// ALLIE v1: suggest metadata for a production + platform.
app.post<{ Params: { id: string }; Body: { platform?: string } }>('/productions/:id/suggest', async (request, reply) => {
  if (!allenConfigured()) return reply.code(503).send({ error: 'ALLEN not configured' });
  const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
  if (!prod) return reply.code(404).send({ error: 'production not found' });
  const platform = request.body?.platform || 'tiktok';
  try {
    return await allenMetadata({
      brand: prod.brand,
      platform,
      topic: prod.topic ?? '',
      persona: prod.persona ?? undefined,
      script: prod.taggedScript || prod.scriptText || undefined
    });
  } catch (err) {
    return reply.code(502).send({ error: `ALLEN: ${(err as Error).message}` });
  }
});

// Production Queue — worker tick and queue management endpoints.
registerWorkerRoutes(app, db, { heygen, drive });
registerQueueRoutes(app, db);
// Atelier delivery — Ad Index, My Poster approval, Final Cut re-upload, download package.
registerDeliveryRoutes(app, db, drive as Parameters<typeof registerDeliveryRoutes>[2]);
// Atelier B-Roll — scene-based AI video generation.
registerAtelierBrollRoutes(app, db);

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
