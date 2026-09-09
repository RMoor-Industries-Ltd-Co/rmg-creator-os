import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as tables from '../src/schema.js';
import {
  enqueueJob,
  claimNextJob,
  recoverStaleJobs,
  findCompletedByIdempotencyKey,
  cancelJob
} from '../src/queue.js';
import type { Database } from '../src/client.js';

// Database-backed integration tests. Concurrency semantics (FOR UPDATE SKIP LOCKED, partial
// unique indexes, lease expiry against now()) cannot be proven against a mock — the whole
// point is what Postgres does when two sessions race, so these run against real Postgres.
//
// Skipped automatically when TEST_DATABASE_URL is unset, so the default `pnpm test` and CI
// stay green without a database. Set it to run them:
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/rmgtest pnpm test
const URL = process.env.TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d('production queue — execution safety (Phase A)', () => {
  let pool: Pool;
  let db: Database;
  const PROD_ID = 'prod-queue-test';

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    db = drizzle(pool, { schema: tables }) as unknown as Database;

    // Minimal schema: only what these tests touch, mirroring the real migrations.
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await db.execute(sql`DO $$ BEGIN
      CREATE TYPE production_job_status AS ENUM ('queued','running','done','failed','cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await db.execute(sql`DO $$ BEGIN
      CREATE TYPE production_job_capability AS ENUM ('aroll','broll','lipsync','audio','thumbnail','poster');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS productions (
      id text PRIMARY KEY, brand text NOT NULL, output_kind text NOT NULL DEFAULT 'post',
      topic text NOT NULL, script_status text NOT NULL DEFAULT 'draft',
      stage text NOT NULL DEFAULT 'script', status text NOT NULL DEFAULT 'active',
      emotion_locked boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS production_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      production_id text NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
      capability production_job_capability NOT NULL, provider text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}', status production_job_status NOT NULL DEFAULT 'queued',
      priority int NOT NULL DEFAULT 10, attempt int NOT NULL DEFAULT 0,
      max_attempts int NOT NULL DEFAULT 2, result_id text, error text,
      locked_until timestamptz, worker_id text, idempotency_key text,
      enqueued_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz)`);
    // The migration under test: the PARTIAL unique index is what makes dedupe race-safe.
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_idempotency_key_uniq
      ON production_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await db.execute(sql`INSERT INTO productions (id, brand, topic) VALUES (${PROD_ID}, 'vlog', 't')
      ON CONFLICT (id) DO NOTHING`);
  });

  afterAll(async () => { await pool?.end(); });

  beforeEach(async () => { await db.execute(sql`DELETE FROM production_jobs`); });

  const add = (over: Partial<Parameters<typeof enqueueJob>[1]> = {}) =>
    enqueueJob(db, { productionId: PROD_ID, capability: 'aroll', provider: 'heygen', ...over });

  // ---- 1. Two concurrent claims cannot receive the same job -------------------------------

  it('two concurrent claims never receive the same job', async () => {
    const { job } = await add();
    // Fire both claims simultaneously against the one queued row.
    const [a, b] = await Promise.all([claimNextJob(db, 'worker-a'), claimNextJob(db, 'worker-b')]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(job.id);
  });

  it('N concurrent workers over N jobs claim each job exactly once', async () => {
    const N = 8;
    for (let i = 0; i < N; i++) await add({ payload: { i } });
    const claims = await Promise.all(
      Array.from({ length: N * 2 }, (_, i) => claimNextJob(db, `worker-${i}`))
    );
    const ids = claims.filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(N);
    expect(new Set(ids).size).toBe(N); // no id claimed twice
  });

  // ---- 2. Claimed jobs receive a lease ----------------------------------------------------

  it('a claim writes status, worker identity and a future lease', async () => {
    await add();
    const job = await claimNextJob(db, 'worker-lease', 120);
    expect(job!.status).toBe('running');
    expect(job!.workerId).toBe('worker-lease');
    expect(job!.lockedUntil).toBeInstanceOf(Date);
    expect(job!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(job!.startedAt).toBeInstanceOf(Date);
  });

  it('a running job is not re-claimed while its lease is live', async () => {
    await add();
    await claimNextJob(db, 'worker-a', 600);
    expect(await claimNextJob(db, 'worker-b')).toBeUndefined();
  });

  it('backoff (queued with a future locked_until) is still respected — retry semantics preserved', async () => {
    const { job } = await add();
    await db.execute(sql`UPDATE production_jobs SET status='queued', attempt=1,
      locked_until = now() + interval '10 minutes' WHERE id = ${job.id}::uuid`);
    expect(await claimNextJob(db, 'worker-a')).toBeUndefined();
    await db.execute(sql`UPDATE production_jobs SET locked_until = now() - interval '1 second' WHERE id = ${job.id}::uuid`);
    expect((await claimNextJob(db, 'worker-a'))?.id).toBe(job.id);
  });

  it('claims respect priority then age', async () => {
    const { job: low } = await add({ priority: 20, payload: { tag: 'low' } });
    const { job: high } = await add({ priority: 1, payload: { tag: 'high' } });
    expect((await claimNextJob(db, 'w'))?.id).toBe(high.id);
    expect((await claimNextJob(db, 'w'))?.id).toBe(low.id);
  });

  // ---- 3 & 4. Expired leases are detected; recovery follows the documented policy ---------

  const expireLease = (id: string) =>
    db.execute(sql`UPDATE production_jobs SET locked_until = now() - interval '1 second' WHERE id = ${id}::uuid`);

  it('an expired lease on a job with NO idempotency key fails it with an operator-actionable reason', async () => {
    const { job } = await add();
    await claimNextJob(db, 'crashed-worker');
    await expireLease(job.id);

    const recovered = await recoverStaleJobs(db);
    expect(recovered).toEqual([
      expect.objectContaining({ jobId: job.id, workerId: 'crashed-worker', outcome: 'failed', attempt: 1 })
    ]);

    const [row] = await db.select().from(tables.productionJobs).where(eq(tables.productionJobs.id, job.id));
    expect(row!.status).toBe('failed');
    // The signal must name the worker and say completion is uncertain — not a bare "failed".
    expect(row!.error).toMatch(/lease expired: crashed-worker/);
    expect(row!.error).toMatch(/Completion is uncertain/);
    expect(row!.error).toMatch(new RegExp(`POST /queue/${row!.id}/retry`));
  });

  it('an expired lease WITH an idempotency key and attempts remaining is re-queued (a safe re-run)', async () => {
    const { job } = await add({ idempotencyKey: 'k-recover', maxAttempts: 3 });
    await claimNextJob(db, 'crashed-worker');
    await expireLease(job.id);

    const recovered = await recoverStaleJobs(db);
    expect(recovered[0]).toMatchObject({ jobId: job.id, outcome: 'requeued', attempt: 1 });

    const [row] = await db.select().from(tables.productionJobs).where(eq(tables.productionJobs.id, job.id));
    expect(row!.status).toBe('queued');
    expect(row!.lockedUntil).toBeNull();
    expect(row!.workerId).toBeNull();
    // Bounded: it is immediately claimable again, not stranded.
    expect((await claimNextJob(db, 'worker-b'))?.id).toBe(job.id);
  });

  it('re-queue is bounded by max_attempts — the last attempt fails instead of looping forever', async () => {
    const { job } = await add({ idempotencyKey: 'k-bounded', maxAttempts: 2 });
    await claimNextJob(db, 'w1');
    await expireLease(job.id);
    expect((await recoverStaleJobs(db))[0]!.outcome).toBe('requeued'); // attempt 1 of 2

    await claimNextJob(db, 'w2');
    await expireLease(job.id);
    expect((await recoverStaleJobs(db))[0]!.outcome).toBe('failed'); // attempt 2 of 2 — stop

    const [row] = await db.select().from(tables.productionJobs).where(eq(tables.productionJobs.id, job.id));
    expect(row!.status).toBe('failed');
  });

  it('a live lease is left alone by the recovery sweep', async () => {
    await add();
    await claimNextJob(db, 'healthy-worker', 600);
    expect(await recoverStaleJobs(db)).toEqual([]);
  });

  // ---- 5. Duplicate / idempotent execution is suppressed ----------------------------------

  it('a duplicate submission with the same key returns the ORIGINAL job and enqueues nothing new', async () => {
    const first = await add({ idempotencyKey: 'k-dup', payload: { v: 1 } });
    const second = await add({ idempotencyKey: 'k-dup', payload: { v: 2 } });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    // The original payload is preserved — a duplicate must never rewrite queued work.
    expect(second.job.payload).toEqual({ v: 1 });

    const all = await db.select().from(tables.productionJobs);
    expect(all).toHaveLength(1);
  });

  it('concurrent duplicate submissions collapse to exactly one job', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => add({ idempotencyKey: 'k-race' })));
    const ids = new Set(results.map((r) => r.job.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
    expect(await db.select().from(tables.productionJobs)).toHaveLength(1);
  });

  it('jobs WITHOUT a key are never deduplicated against each other', async () => {
    await add(); await add(); await add();
    expect(await db.select().from(tables.productionJobs)).toHaveLength(3);
  });

  it('a completed result is discoverable by key, so a re-run can reuse it instead of repeating work', async () => {
    const { job } = await add({ idempotencyKey: 'k-done' });
    await db.update(tables.productionJobs)
      .set({ status: 'done', resultId: 'render-xyz' })
      .where(eq(tables.productionJobs.id, job.id));

    const found = await findCompletedByIdempotencyKey(db, 'k-done');
    expect(found?.resultId).toBe('render-xyz');
    // Excluding the row itself is what the worker does, so it never matches its own job.
    expect(await findCompletedByIdempotencyKey(db, 'k-done', job.id)).toBeUndefined();
    expect(await findCompletedByIdempotencyKey(db, 'k-missing')).toBeUndefined();
  });

  // ---- Cancellation is an atomic transition, not a read-then-write ----------------------

  it('cancels a queued job', async () => {
    const { job } = await add();
    expect(await cancelJob(db, job.id)).toMatchObject({ outcome: 'cancelled' });
    const [row] = await db.select().from(tables.productionJobs).where(eq(tables.productionJobs.id, job.id));
    expect(row!.status).toBe('cancelled');
  });

  it('LOSES the race cleanly when a worker claims the job first — it must not report success', async () => {
    const { job } = await add();
    // Claim wins, then cancel arrives: the row is `running` with a live lease, so the
    // conditional update matches nothing. Previously the unconditional update would have
    // written `cancelled` while the worker went on to dispatch paid work.
    await claimNextJob(db, 'worker-a', 600);
    const res = await cancelJob(db, job.id);
    expect(res.outcome).toBe('refused');
    if (res.outcome === 'refused') expect(res.reason).toMatch(/lease is live/);

    const [row] = await db.select().from(tables.productionJobs).where(eq(tables.productionJobs.id, job.id));
    expect(row!.status).toBe('running'); // the worker still owns it
  });

  it('a concurrent claim and cancel never both succeed', async () => {
    const { job } = await add();
    const [claim, cancel] = await Promise.all([claimNextJob(db, 'worker-a', 600), cancelJob(db, job.id)]);
    const bothWon = Boolean(claim) && cancel.outcome === 'cancelled';
    expect(bothWon).toBe(false);
  });

  it('cancels a running job whose lease has EXPIRED — the abandoned-job control', async () => {
    const { job } = await add();
    await claimNextJob(db, 'crashed-worker');
    await expireLease(job.id);
    expect(await cancelJob(db, job.id)).toMatchObject({ outcome: 'cancelled' });
  });

  it.each(['done', 'failed', 'cancelled'] as const)(
    'refuses to overwrite an already-%s job', async (status) => {
      const { job } = await add();
      await db.execute(sql`UPDATE production_jobs SET status = ${status}::production_job_status,
        result_id = 'keep-me' WHERE id = ${job.id}::uuid`);
      const res = await cancelJob(db, job.id);
      expect(res.outcome).toBe('refused');
      if (res.outcome === 'refused') expect(res.reason).toMatch(new RegExp(`already ${status}`));

      const [row] = await db.select().from(tables.productionJobs).where(eq(tables.productionJobs.id, job.id));
      expect(row!.status).toBe(status);      // outcome preserved
      expect(row!.resultId).toBe('keep-me'); // result not destroyed
    }
  );

  it('reports not_found for an unknown job', async () => {
    expect(await cancelJob(db, '00000000-0000-0000-0000-000000000000')).toEqual({ outcome: 'not_found' });
  });
});
