// apps/gateway/src/worker.ts
// Worker tick — claims and executes the next queued production job.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { checkWorkerSecret, WORKER_AUTH_REQUIRED_CODE } from './workerAuth.js';
import { eq } from '@rmg-creator-os/db';
import { tables, claimNextJob, recoverStaleJobs, findCompletedByIdempotencyKey, DEFAULT_LEASE_SECONDS } from '@rmg-creator-os/db';
import type { Database } from '@rmg-creator-os/db';
import {
  createDefaultRendererRegistry,
  type RendererRegistry,
  type GenerateVideoOptions
} from '@rmg-creator-os/integrations';

const WORKER_SECRET = process.env.WORKER_SECRET ?? '';

/** Lease length for a claim. Overridable per-deployment; a render that legitimately runs
 *  longer than this would be recovered mid-flight, so it is generous by default. */
const LEASE_SECONDS = Number(process.env.WORKER_LEASE_SECONDS ?? DEFAULT_LEASE_SECONDS);

/** Identity written onto every claim. Stable per process so a stranded job names the worker
 *  that held it — `worker_id` was previously declared in the schema and never written. */
const WORKER_ID = process.env.WORKER_ID ?? `gateway-${process.pid}-${randomUUID().slice(0, 8)}`;

type ProductionJob = typeof tables.productionJobs.$inferSelect;

type WorkerClients = {
  // Typed against the real client's options rather than `Record<string, unknown>`: under v2
  // the loose type let the dispatch payload drift from what the client accepts, which is
  // exactly the mismatch the v3 port had to find by hand.
  heygen: { generateVideo: (opts: GenerateVideoOptions) => Promise<{ videoId: string }> } | null;
  drive: { uploadBuffer: (opts: { bytes: Buffer; name: string; folderId: string; mimeType: string }) => Promise<{ fileId: string; webViewLink?: string }> } | null;
};

// Formalized (capability, provider) dispatch (Sprint 1 PR 4 — see packages/integrations/src/
// renderer.ts and docs/atelier/renderer-boundary.md). HeyGen's `aroll` path stays a direct
// client call, unchanged — only the previously ad-hoc broll/audio/thumbnail/default stubs are
// now routed through a Renderer (NullRenderer), which reproduces their exact prior output.
// Exported only for the dispatch-behavior tests (apps/gateway/test/worker.test.ts) — not a
// new public surface for other modules to call.
/**
 * Capabilities that exist in the database enum but cannot yet be executed.
 *
 * Kept as data rather than an inline check so that adding a dispatcher means deleting one
 * line here — and so the set is greppable from the migration that introduced the value.
 */
const UNIMPLEMENTED_CAPABILITIES = new Set<string>(['accord_article']);

export async function dispatch(
  job: ProductionJob,
  clients: WorkerClients,
  renderers: RendererRegistry
): Promise<{ resultId: string }> {
  const { capability, provider, payload } = job;

  if (capability === 'aroll' && provider === 'heygen') {
    const client = clients.heygen;
    if (!client) throw new Error('HeyGen client not configured');
    const p = payload as {
      photoAvatarId?: string;
      /** v2 payloads only. A talking-photo id is not a v3 look id, so it is refused rather
       *  than forwarded — sending it would 4xx at best and address the wrong avatar at worst. */
      talkingPhotoId?: string;
      audioUrl?: string;
      useAvatarIv?: boolean;
      customMotionPrompt?: string;
      dimension?: { width: number; height: number };
      title?: string;
    };
    if (!p.photoAvatarId && p.talkingPhotoId) {
      throw new Error(
        'aroll payload carries a v2 talkingPhotoId, which is not a v3 avatar look id — re-enqueue this render'
      );
    }
    if (!p.photoAvatarId || !p.audioUrl) throw new Error('aroll payload missing photoAvatarId or audioUrl');
    const { videoId } = await client.generateVideo({
      avatarId: p.photoAvatarId,
      audioUrl: p.audioUrl,
      useAvatarIv: p.useAvatarIv ?? true,
      customMotionPrompt: p.customMotionPrompt,
      dimension: p.dimension ?? { width: 720, height: 1280 },
      title: p.title,
    });
    return { resultId: videoId };
  }

  // Capabilities whose enum value exists but which have no real dispatcher yet. Migration
  // 0023 adds `accord_article` so an Accord job can be ENQUEUED (§3.4) — but the registry's
  // fallback is a NullRenderer, which returns a stub id, and `runWorkerTick` would then mark
  // the job `done`. A governed job reported as complete having produced nothing is strictly
  // worse than one that fails: the failure is visible and the false success is not.
  //
  // So the enum value being legal must not imply the work is performable. This throws, which
  // takes the job down the normal failure path (attempt/backoff, then `failed` with a reason)
  // instead of the silent-success path.
  if (UNIMPLEMENTED_CAPABILITIES.has(capability)) {
    throw new Error(
      `capability '${capability}' has no dispatcher yet — enqueueing is supported, execution is not`
    );
  }

  const renderer = renderers.resolve(capability, provider);
  if (renderer) {
    return renderer.render({ id: job.id, capability, provider, payload });
  }

  // Defensive fallback — createDefaultRendererRegistry() always sets a NullRenderer fallback,
  // so this path is unreachable in practice; kept to match the prior code's total behavior.
  console.log(`[worker] dispatching job ${job.id} capability=${capability} provider=${provider}`);
  return { resultId: `stub-${job.id}` };
}

/** Outcome of one recovery sweep. */
export type RecoverResult = { recovered: Awaited<ReturnType<typeof recoverStaleJobs>> };

/** Outcome of one tick. `claimed: false` means the queue had nothing runnable. */
export type TickResult =
  | { claimed: false; recovered: RecoverResult['recovered'] }
  | {
      claimed: true;
      jobId: string;
      status: 'done' | 'requeued' | 'failed';
      resultId?: string;
      deduplicated?: boolean;
      attempt?: number;
      error?: string;
      recovered: RecoverResult['recovered'];
    };

/** Sweep abandoned work (running rows whose lease expired). */
export async function runWorkerRecover(db: Database): Promise<RecoverResult> {
  return { recovered: await recoverStaleJobs(db) };
}

/**
 * One unit of worker work: recover, claim, execute, record.
 *
 * Extracted from the HTTP handler so the in-process ticker can call it directly rather than
 * issuing an authenticated HTTP request to itself — a self-call would need the machine
 * credential in its own process and would add a second, needless way into the execution lane.
 * The HTTP route remains, for an operator or an external scheduler.
 */
export async function runWorkerTick(
  db: Database,
  clients: WorkerClients,
  renderers: RendererRegistry,
  opts: { workerId?: string; leaseSeconds?: number } = {}
): Promise<TickResult> {
  const workerId = opts.workerId ?? WORKER_ID;
  const leaseSeconds = opts.leaseSeconds ?? LEASE_SECONDS;

  // Sweep abandoned work first, so a job stranded by a crashed worker becomes runnable (or
  // visibly failed) instead of sitting in `running` forever with nothing to move it.
  const recovered = await recoverStaleJobs(db);

  // Atomic claim: one statement, FOR UPDATE SKIP LOCKED. Two concurrent ticks cannot both
  // receive this row — which is what previously allowed a duplicated paid render.
  const job = await claimNextJob(db, workerId, leaseSeconds);
  if (!job) {
    return { claimed: false, recovered };
  }

  try {
    // Idempotency: if this key already produced a completed result, reuse it rather than
    // repeating the work. This is what makes a recovery re-queue safe.
    if (job.idempotencyKey) {
      const done = await findCompletedByIdempotencyKey(db, job.idempotencyKey, job.id);
      if (done?.resultId) {
        await db
          .update(tables.productionJobs)
          .set({ status: 'done', resultId: done.resultId, completedAt: new Date(), lockedUntil: null })
          .where(eq(tables.productionJobs.id, job.id));
        return { claimed: true, jobId: job.id, status: 'done', resultId: done.resultId, deduplicated: true, recovered };
      }
    }

    const { resultId } = await dispatch(job, clients, renderers);
    await db
      .update(tables.productionJobs)
      .set({ status: 'done', resultId, completedAt: new Date(), lockedUntil: null })
      .where(eq(tables.productionJobs.id, job.id));
    return { claimed: true, jobId: job.id, status: 'done', resultId, recovered };
  } catch (err) {
    const nextAttempt = (job.attempt ?? 0) + 1;
    const maxAttempts = job.maxAttempts ?? 2;
    if (nextAttempt < maxAttempts) {
      // Unchanged backoff semantics: re-queue with locked_until in the future, which the
      // claim query already respects. Clearing worker_id keeps the lease honest.
      const backoffSecs = nextAttempt * 30;
      const lockedUntil = new Date(Date.now() + backoffSecs * 1000);
      await db
        .update(tables.productionJobs)
        .set({ status: 'queued', attempt: nextAttempt, lockedUntil, workerId: null })
        .where(eq(tables.productionJobs.id, job.id));
      return { claimed: true, jobId: job.id, status: 'requeued', attempt: nextAttempt, recovered };
    }
    const error = (err as Error).message;
    await db
      .update(tables.productionJobs)
      .set({ status: 'failed', attempt: nextAttempt, error, completedAt: new Date(), lockedUntil: null })
      .where(eq(tables.productionJobs.id, job.id));
    return { claimed: true, jobId: job.id, status: 'failed', error, recovered };
  }
}

export function registerWorkerRoutes(
  app: FastifyInstance,
  db: Database,
  clients: WorkerClients = { heygen: null, drive: null },
  renderers: RendererRegistry = createDefaultRendererRegistry()
) {
  // Encapsulated scope: the machine-auth hook applies to EVERY route registered inside it,
  // so a worker route added later cannot forget its own check. server.ts's session guard
  // skips these paths (isWorkerRoute) — they are machine-authenticated, not public.
  void app.register(async (worker) => {
    worker.addHook('onRequest', async (request, reply) => {
      const result = checkWorkerSecret(
        request.headers['x-worker-secret'] as string | undefined,
        WORKER_SECRET
      );
      if (!result.authorized) {
        request.log.warn(
          { path: request.url, reason: result.reason },
          '[worker] rejected unauthenticated worker request'
        );
        return reply.code(401).send({ error: 'unauthorized', code: WORKER_AUTH_REQUIRED_CODE });
      }
    });

    // POST /worker/recover — sweep abandoned jobs (running rows whose lease expired).
    // Exposed separately so an operator can run recovery without also claiming work.
    worker.post('/worker/recover', async () => runWorkerRecover(db));

    // POST /worker/tick — claim and execute the next queued job.
    worker.post('/worker/tick', async () => runWorkerTick(db, clients, renderers));
  });
}

// --- In-process dispatcher ---------------------------------------------------------------
//
// Phase A.1 §3. Before this, nothing dispatched: no worker service in compose, no cron entry
// for the worker, no dashboard call, no CI job. Queued jobs sat queued.
//
// This is the smallest mechanism consistent with the existing deployment: a `setInterval` in
// the gateway process, which is already a long-running container that restarts under compose's
// restart policy. It introduces no new service, image, queue, broker or repository. It calls
// `runWorkerTick` in-process — no self-HTTP, so it needs no credential and widens no auth
// surface. Concurrency is already safe: the Phase A claim is atomic (FOR UPDATE SKIP LOCKED),
// so even several gateway replicas ticking at once cannot claim the same job.
//
// OFF BY DEFAULT. Enabling it starts executing queued work, some of which is paid external
// rendering, so the switch is a deliberate deploy-time act (`WORKER_TICK_ENABLED=true`), not
// something a merge turns on.

/** Default gap between ticks. Short enough to feel responsive, long enough that an idle
 *  queue costs one trivial indexed query per interval. */
export const DEFAULT_TICK_INTERVAL_MS = 15_000;

export type WorkerTicker = { stop: () => void };

export type TickLogger = {
  info: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
};

/**
 * Wrap a tick in the two properties an interval-driven worker needs, and nothing else:
 *
 *  - **No overlap.** A tick that outruns the interval must not stack. Skipping is correct
 *    rather than queueing — the next interval picks the work up, and the row's lease protects
 *    it in the meantime.
 *  - **No throw.** A failing tick must never reach the interval callback, where an unhandled
 *    rejection could take the gateway process down. The dispatcher outliving a bad job is the
 *    whole point of running it in-process.
 *
 * Extracted so both properties are unit-testable without a timer or a database.
 */
export function createNonOverlappingRunner(
  run: () => Promise<{ claimed: boolean; jobId?: string; status?: string }>,
  log: TickLogger
): { tick: () => Promise<void>; isRunning: () => boolean } {
  let inFlight = false;
  return {
    isRunning: () => inFlight,
    tick: async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await run();
        if (result.claimed) {
          log.info({ jobId: result.jobId, status: result.status }, '[worker] tick executed job');
        }
      } catch (err) {
        log.error({ err: (err as Error).message }, '[worker] tick failed');
      } finally {
        inFlight = false;
      }
    }
  };
}

export function startWorkerTicker(opts: {
  db: Database;
  clients?: WorkerClients;
  renderers?: RendererRegistry;
  intervalMs?: number;
  log?: TickLogger;
}): WorkerTicker | null {
  if (process.env.WORKER_TICK_ENABLED !== 'true') return null;

  const intervalMs = opts.intervalMs ?? Number(process.env.WORKER_TICK_INTERVAL_MS ?? DEFAULT_TICK_INTERVAL_MS);
  const clients = opts.clients ?? { heygen: null, drive: null };
  const renderers = opts.renderers ?? createDefaultRendererRegistry();
  const log = opts.log ?? console;

  const { tick } = createNonOverlappingRunner(() => runWorkerTick(opts.db, clients, renderers), log);

  const handle = setInterval(() => void tick(), intervalMs);
  // Do not hold the event loop open on this alone.
  if (typeof handle.unref === 'function') handle.unref();
  log.info({ intervalMs, workerId: WORKER_ID }, '[worker] in-process ticker started');

  return { stop: () => clearInterval(handle) };
}
