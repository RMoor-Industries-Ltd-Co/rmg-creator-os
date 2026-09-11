import type { Database } from './client.js';
import { productionJobs } from './schema.js';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

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

type EnqueueJobFields = {
  capability: typeof productionJobs.$inferInsert['capability'];
  provider: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  /** Optional dedupe identity. When supplied and already present, the EXISTING job is
   *  returned and nothing new is inserted. Omit it to keep the pre-Phase-A behavior. */
  idempotencyKey?: string;
};

/**
 * A job has exactly one parent — a production, or (Phase B1, §3.4) a work item — never both,
 * never neither. Before this union existed, `EnqueueJobInput` required a non-null
 * `productionId` and exposed no `workItemId`, so `{ productionId, capability: 'accord_article' }`
 * TYPE-CHECKED (fabricating a video parent for a non-video job — precisely the shortcut §3.4
 * rejects) while the valid work-item shape was impossible to express through this API at all
 * (issue #56 item 11). `workItemId?: undefined` / `productionId?: undefined` on the opposite
 * branch is what makes the two variants mutually exclusive at the type level — an object
 * literal supplying both, or neither, fails to compile against either branch.
 */
export type EnqueueJobInput = EnqueueJobFields &
  ({ productionId: string; workItemId?: undefined } | { productionId?: undefined; workItemId: string });

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
  // Defense in depth beyond the type: a caller that builds `input` dynamically (JS, a
  // spread, an `as` cast) is not protected by the union's compile-time exclusivity. Failing
  // loudly here — rather than silently preferring one field or letting the database's
  // `production_jobs_one_parent` CHECK report a less legible error — keeps the "exactly one
  // parent" rule visible at the API boundary where a caller can actually act on it.
  const hasProductionId = input.productionId !== undefined && input.productionId !== null;
  const hasWorkItemId = input.workItemId !== undefined && input.workItemId !== null;
  if (hasProductionId === hasWorkItemId) {
    throw new Error(
      `enqueueJob: exactly one of productionId or workItemId is required (got productionId=${JSON.stringify(input.productionId)}, workItemId=${JSON.stringify(input.workItemId)})`
    );
  }

  const values = {
    productionId: hasProductionId ? input.productionId : null,
    workItemId: hasWorkItemId ? input.workItemId : null,
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

export interface AwaitingApprovalEntry {
  jobId: string;
  capability: typeof productionJobs.$inferSelect['capability'];
  productionId: string | null;
  workItemId: string | null;
  /** WHAT is waiting on WHOM (§13 step 11) — the gate's own descriptor, written atomically at
   *  enqueue from server-side policy (never caller input) and frozen thereafter by trigger, so
   *  this is exactly what the gate itself recorded, not a re-derivation. */
  gateOrigin: string | null;
  gateSubjectType: string | null;
  gateSubjectId: string | null;
  gateScope: string | null;
  /** SINCE WHEN (§13 step 11). Approximated as `enqueued_at` — exact for a job gated at
   *  enqueue time (the only path that exists today; there is no live writer that moves an
   *  already-`queued` job into `awaiting_approval` later — §13 step 6/B1.5 step 12 are both
   *  still blocked, see docs/atelier/b1-2-dependency-split.md). Once a write path exists that
   *  can transition a job into this state after it was already queued, the accurate source
   *  becomes the most recent `workflow_transitions` row for this job with `to_state =
   *  'awaiting_approval'` (recordWorkflowTransition, packages/db/src/transitions.ts) — this
   *  function does not attempt that join yet because nothing writes such a row. */
  waitingSince: Date;
}

/**
 * The waiting-for-approval surface (§13 step 11): every job currently paused in
 * `awaiting_approval`, oldest first — "an approval queue nobody can see is a durable pause that
 * behaves like a lost job." Read-only; does not require the (still-blocked) approval write path
 * to exist, only that a row can legitimately be AT REST in this status, which the schema and its
 * completeness CHECK already allow (governance.migration.test.ts exercises that CHECK directly).
 */
export async function listAwaitingApproval(db: Database, limit = 100): Promise<AwaitingApprovalEntry[]> {
  const rows = await db
    .select({
      jobId: productionJobs.id,
      capability: productionJobs.capability,
      productionId: productionJobs.productionId,
      workItemId: productionJobs.workItemId,
      gateOrigin: productionJobs.gateOrigin,
      gateSubjectType: productionJobs.gateSubjectType,
      gateSubjectId: productionJobs.gateSubjectId,
      gateScope: productionJobs.gateScope,
      waitingSince: productionJobs.enqueuedAt
    })
    .from(productionJobs)
    .where(eq(productionJobs.status, 'awaiting_approval'))
    .orderBy(productionJobs.enqueuedAt)
    .limit(limit);
  return rows;
}

export type CancelOutcome =
  | { outcome: 'cancelled'; job: typeof productionJobs.$inferSelect }
  | { outcome: 'not_found' }
  | { outcome: 'refused'; status: string; reason: string };

/**
 * Cancel a job as ONE conditional statement.
 *
 * Reading the row and then updating it by id alone is not safe, even though the read looks
 * like a guard: between the two statements a worker can atomically claim the job, so the
 * caller is told "cancelled" while the worker goes on to dispatch **paid** work and then
 * overwrites the row as `done`. The same unconditional update could also rewrite an already
 * `done` or `failed` job as `cancelled`, destroying its outcome.
 *
 * So the allowed transitions are encoded in the WHERE clause and the database decides:
 *
 *  - `queued`                                  → cancelled
 *  - `running` **with an expired lease**       → cancelled (the abandoned-job control)
 *  - anything else                             → no row updated, and the caller is refused
 *
 * A racing claim flips the row to `running` with a live lease, so the predicate stops
 * matching and zero rows come back — the cancel loses the race cleanly instead of lying.
 */
export async function cancelJob(db: Database, jobId: string): Promise<CancelOutcome> {
  const [cancelled] = await db
    .update(productionJobs)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(
      and(
        eq(productionJobs.id, jobId),
        sql`(
          ${productionJobs.status} = 'queued'
          OR (${productionJobs.status} = 'running' AND ${productionJobs.lockedUntil} < now())
        )`
      )
    )
    .returning();

  if (cancelled) return { outcome: 'cancelled', job: cancelled };

  // Nothing was updated: either the job does not exist, or it is in a state cancel refuses.
  // Re-read only to explain why — the decision itself was already made atomically above.
  const [current] = await db.select().from(productionJobs).where(eq(productionJobs.id, jobId));
  if (!current) return { outcome: 'not_found' };

  const reason =
    current.status === 'running'
      ? 'cannot cancel a running job while its lease is live'
      : `cannot cancel a job that is already ${current.status}`;
  return { outcome: 'refused', status: current.status, reason };
}
