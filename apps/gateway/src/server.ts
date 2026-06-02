// apps/gateway/src/server.ts
// The RMG Creator OS control plane: orchestrator API the dashboard talks to.

import cors from '@fastify/cors';
import { createDb, runMigrations, tables } from '@rmg-creator-os/db';
import type { HealthResponse, JobInput } from '@rmg-creator-os/types';
import Fastify from 'fastify';
import { Redis } from 'ioredis';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const REDIS_URL = process.env.REDIS_URL ?? '';

const { db, pool } = createDb(DATABASE_URL);
const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });

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

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
