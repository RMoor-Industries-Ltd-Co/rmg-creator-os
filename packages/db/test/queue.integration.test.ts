import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
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
import { provisionDatabase } from './support/database.js';

// Database-backed integration tests. Concurrency semantics (FOR UPDATE SKIP LOCKED, partial
// unique indexes, lease expiry against now()) cannot be proven against a mock — the whole
// point is what Postgres does when two sessions race, so these run against real Postgres.
//
// Skipped automatically when TEST_DATABASE_URL is unset, so the default `pnpm test` and CI
// stay green without a database. Set it to run them:
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/rmgtest pnpm test
const DB_URL = process.env.TEST_DATABASE_URL;
const d = DB_URL ? describe : describe.skip;

d('production queue — execution safety (Phase A)', () => {
  let pool: Pool;
  let db: Database;
  const PROD_ID = 'prod-queue-test';

  beforeAll(async () => {
    // Own database: suites run in parallel and this one is not read-only, so sharing one
    // schema raced the governance suite's from-empty migration run.
    const url = await provisionDatabase('queue');
    pool = new Pool({ connectionString: url ?? DB_URL });
    db = drizzle(pool, { schema: tables }) as unknown as Database;

    // The REAL migrations, not a hand-written subset.
    //
    // This suite used to build a minimal schema by hand. That was wrong in a way only a
    // schema change revealed: when Phase B1 added columns to `production_jobs`, the Drizzle
    // model began selecting columns the hand-written table did not have and every test here
    // failed with `column does not exist` — drift the mirror could never detect, because it
    // only ever described what its author remembered to copy.
    //
    // Applying the migrations makes the schema under test the schema that ships, so this
    // suite fails when a migration is broken rather than when someone forgets a mirror.
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
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

  // ---- EnqueueJobInput's parent-discriminated union (§3.4, issue #56 item 11) -------------
  //
  // Before this union existed, an Accord (work-item-parented) job was impossible to enqueue at
  // all — EnqueueJobInput required productionId and had no workItemId, so the only way to
  // enqueue accord_article work was to fabricate a video production, the exact shortcut §3.4
  // rejects. These tests prove both the valid work-item shape now works, and that the union's
  // "exactly one parent" rule is enforced at the application boundary (enqueueJob throws) as
  // well as at the database (production_jobs_one_parent / production_jobs_parent_matches_capability).
  describe('EnqueueJobInput — work-item parent', () => {
    async function newWorkItem(): Promise<string> {
      const [row] = await db
        .insert(tables.workItems)
        .values({ kind: 'accord_article', brand: 'hvn' })
        .returning();
      return row!.id;
    }

    it('enqueues a work-item-parented job with the accord_article capability', async () => {
      const workItemId = await newWorkItem();
      const { job } = await enqueueJob(db, { workItemId, capability: 'accord_article', provider: 'accord' });
      expect(job.productionId).toBeNull();
      expect(job.workItemId).toBe(workItemId);
      expect(job.capability).toBe('accord_article');
    });

    it('rejects a call supplying BOTH productionId and workItemId', async () => {
      const workItemId = await newWorkItem();
      await expect(
        enqueueJob(db, {
          // @ts-expect-error — deliberately violating the union to prove the runtime guard,
          // not just the compile-time one, refuses this.
          productionId: PROD_ID,
          workItemId,
          capability: 'accord_article',
          provider: 'accord'
        })
      ).rejects.toThrow(/exactly one of productionId or workItemId/);
    });

    it('rejects a call supplying NEITHER productionId nor workItemId', async () => {
      await expect(
        enqueueJob(db, {
          // @ts-expect-error — deliberately violating the union to prove the runtime guard.
          capability: 'accord_article',
          provider: 'accord'
        })
      ).rejects.toThrow(/exactly one of productionId or workItemId/);
    });

    it('the database rejects a work-item parent paired with a non-accord_article capability', async () => {
      // production_jobs_parent_matches_capability: (capability = 'accord_article') = (work_item_id IS NOT NULL).
      // A work-item job carrying any other capability violates the biconditional.
      const workItemId = await newWorkItem();
      await expect(enqueueJob(db, { workItemId, capability: 'broll', provider: 'stock' })).rejects.toThrow();
    });

    it('the database rejects the accord_article capability paired with a production parent', async () => {
      // The other half of the same biconditional — fabricating a video parent for Accord work
      // is exactly the shortcut §3.4 rejects, and the database refuses it even if application
      // code somehow constructed this pairing.
      await expect(
        enqueueJob(db, { productionId: PROD_ID, capability: 'accord_article', provider: 'accord' })
      ).rejects.toThrow();
    });
  });
});
