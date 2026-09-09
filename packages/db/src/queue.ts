import type { Database } from './client.js';
import { productionJobs } from './schema.js';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

/**
 * Queue primitives for the Postgres-backed production job backbone.
 *
 * D-B (ratified 2026-09-09): Postgres is the authoritative queue for the Master Atelier
 * initiative. BullMQ is not introduced here; any future migration is a separate decision.
 *
 * Three safety properties this module owns, each previously absent:
 *
 *  1. **Atomic claim.** `claimNextJob` is ONE statement. The prior flow read a row and then
 *     updated it in a second statement, so two concurrent workers could select the same row
 *     and both dispatch it — for `capability = 'aroll'` that is a duplicated *paid* render.
 *  2. **Leases.** A claim writes `locked_until` (and `worker_id`). A `running` row whose
 *     lease has passed is presumed abandoned and is recoverable; previously nothing ever
 *     moved a job out of `running`, so a worker crash stranded it permanently.
 *  3. **Idempotency.** A caller-supplied key is stored and uniquely indexed, so a duplicate
 *     submission returns the original job rather than enqueuing the same paid work twice.
 */

/** How long a claim is held before the job is presumed abandoned. */
export const DEFAULT_LEASE_SECONDS = 900;

export type EnqueueJobInput = {
  productionId: string;
  capability: typeof productionJobs.$inferInsert['capability'];
  provider: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  /** Optional dedupe identity. When supplied and already present, the EXISTING job is
   *  returned and nothing new is inserted. Omit it to keep the pre-Phase-A behavior. */
  idempotencyKey?: string;
};

export type EnqueueResult = {
  job: typeof productionJobs.$inferSelect;
  /** True when an existing job was returned instead of inserting a new one. */
  deduplicated: boolean;
};

/**
 * Insert a new production job, or return the existing one when `idempotencyKey` collides.
 *
 * `ON CONFLICT DO NOTHING` + a follow-up select is deliberate: it is race-safe (the unique
 * index is the arbiter, not a read-then-write check) and it never overwrites the original
 * job's payload, which would silently change work already queued or completed.
 */
export async function enqueueJob(db: Database, input: EnqueueJobInput): Promise<EnqueueResult> {
  const values = {
    productionId: input.productionId,
    capability: input.capability,
    provider: input.provider,
    payload: input.payload ?? {},
    priority: input.priority ?? 10,
    maxAttempts: input.maxAttempts ?? 2,
    idempotencyKey: input.idempotencyKey ?? null
  };

  if (!input.idempotencyKey) {
    const [row] = await db.insert(productionJobs).values(values).returning();
    return { job: row!, deduplicated: false };
  }

  const inserted = await db
    .insert(productionJobs)
    .values(values)
    // The unique index is PARTIAL, so Postgres cannot infer it from the target column alone —
    // the index predicate must be repeated here or it raises 42P10 ("no unique or exclusion
    // constraint matching the ON CONFLICT specification").
    .onConflictDoNothing({
      target: productionJobs.idempotencyKey,
      where: isNotNull(productionJobs.idempotencyKey)
    })
    .returning();

  if (inserted[0]) return { job: inserted[0], deduplicated: false };

  const [existing] = await db
    .select()
    .from(productionJobs)
    .where(eq(productionJobs.idempotencyKey, input.idempotencyKey));
  // The unique index guarantees this row exists: the insert conflicted against it.
  return { job: existing!, deduplicated: true };
}

/**
 * Atomically claim the next runnable job, or return `undefined` when there is none.
 *
 * The whole claim is a single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`.
 * `SKIP LOCKED` is what makes concurrency safe: a second worker running the same statement
 * skips the row the first has locked rather than blocking on it or, worse, reading it as
 * available. There is no window between "chosen" and "marked running" for a racing worker to
 * observe.
 *
 * Selection preserves the pre-existing semantics exactly: `queued` only, respecting a future
 * `locked_until` (which retry backoff sets), ordered by priority then age.
 */
export async function claimNextJob(
  db: Database,
  workerId: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS
): Promise<typeof productionJobs.$inferSelect | undefined> {
  const [claimed] = await db
    .update(productionJobs)
    .set({
      status: 'running',
      startedAt: new Date(),
      workerId,
      lockedUntil: sql`now() + make_interval(secs => ${leaseSeconds})`
    })
    .where(
      sql`${productionJobs.id} = (
        SELECT id
          FROM production_jobs
         WHERE status = 'queued'
           AND (locked_until IS NULL OR locked_until < now())
         ORDER BY priority, enqueued_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )`
    )
    .returning();
  return claimed;
}

export type StaleRecovery = {
  jobId: string;
  workerId: string | null;
  /** `requeued` only where a re-run is provably safe; otherwise `failed` for an operator. */
  outcome: 'requeued' | 'failed';
  attempt: number;
};

/**
 * Recover jobs whose worker died mid-flight — `running` rows with an expired lease.
 *
 * **The policy, stated exactly, because it decides whether paid work can be repeated:**
 *
 * An expired lease means the worker stopped reporting. It does NOT mean the work did not
 * happen — the render may have completed remotely just before the crash. So completion is
 * *uncertain*, and the recovery must not silently re-run it.
 *
 *  - **With an idempotency key, and attempts remaining → `requeued`.** A re-run is provably
 *    safe here: the key lets execution detect the already-completed work and reuse its
 *    result instead of repeating it. Bounded by `max_attempts` like any other retry.
 *  - **Otherwise → `failed`**, with an explicit error naming the lease and the worker. The
 *    job stops (gate), the reason is visible in `GET /queue` (signal), and the operator
 *    clears it with the existing `POST /queue/:id/retry` (control).
 *
 * That triad is deliberate: a condition that can stop work needs a gate, a signal in words,
 * and a control that clears it. Two out of three is a silent halt — which is precisely what
 * the previous behavior was, since nothing ever moved a job out of `running` at all.
 */
export async function recoverStaleJobs(db: Database, limit = 25): Promise<StaleRecovery[]> {
  const stale = await db
    .select()
    .from(productionJobs)
    .where(and(eq(productionJobs.status, 'running'), sql`${productionJobs.lockedUntil} < now()`))
    .orderBy(productionJobs.lockedUntil)
    .limit(limit);

  const out: StaleRecovery[] = [];
  for (const job of stale) {
    const attempt = (job.attempt ?? 0) + 1;
    const canSafelyRerun = Boolean(job.idempotencyKey) && attempt < (job.maxAttempts ?? 2);
    const who = job.workerId ?? 'unknown worker';

    if (canSafelyRerun) {
      await db
        .update(productionJobs)
        .set({ status: 'queued', attempt, lockedUntil: null, workerId: null, startedAt: null })
        .where(and(eq(productionJobs.id, job.id), eq(productionJobs.status, 'running')));
      out.push({ jobId: job.id, workerId: job.workerId, outcome: 'requeued', attempt });
    } else {
      await db
        .update(productionJobs)
        .set({
          status: 'failed',
          attempt,
          completedAt: new Date(),
          error:
            `lease expired: ${who} did not report completion. Completion is uncertain, so the ` +
            `job was not re-run automatically (no idempotency key, or attempts exhausted). ` +
            `Inspect the provider, then POST /queue/${job.id}/retry to re-queue it.`
        })
        .where(and(eq(productionJobs.id, job.id), eq(productionJobs.status, 'running')));
      out.push({ jobId: job.id, workerId: job.workerId, outcome: 'failed', attempt });
    }
  }
  return out;
}

/**
 * Find an already-completed job carrying `key`, so execution can reuse its result rather
 * than repeating the work. This is what makes a recovery `requeue` safe.
 */
export async function findCompletedByIdempotencyKey(
  db: Database,
  key: string,
  excludeJobId?: string
): Promise<typeof productionJobs.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(productionJobs)
    .where(
      and(
        eq(productionJobs.idempotencyKey, key),
        eq(productionJobs.status, 'done'),
        isNotNull(productionJobs.resultId)
      )
    );
  return rows.find((r) => r.id !== excludeJobId);
}
