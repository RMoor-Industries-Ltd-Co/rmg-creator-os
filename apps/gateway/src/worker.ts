// apps/gateway/src/worker.ts
// Worker tick — claims and executes the next queued production job.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from '@rmg-creator-os/db';
import { tables, claimNextJob, recoverStaleJobs, findCompletedByIdempotencyKey, DEFAULT_LEASE_SECONDS } from '@rmg-creator-os/db';
import type { Database } from '@rmg-creator-os/db';
import { createDefaultRendererRegistry, type RendererRegistry } from '@rmg-creator-os/integrations';

const WORKER_SECRET = process.env.WORKER_SECRET ?? '';

/** Lease length for a claim. Overridable per-deployment; a render that legitimately runs
 *  longer than this would be recovered mid-flight, so it is generous by default. */
const LEASE_SECONDS = Number(process.env.WORKER_LEASE_SECONDS ?? DEFAULT_LEASE_SECONDS);

/** Identity written onto every claim. Stable per process so a stranded job names the worker
 *  that held it — `worker_id` was previously declared in the schema and never written. */
const WORKER_ID = process.env.WORKER_ID ?? `gateway-${process.pid}-${randomUUID().slice(0, 8)}`;

type ProductionJob = typeof tables.productionJobs.$inferSelect;

type WorkerClients = {
  heygen: { generateVideo: (opts: Record<string, unknown>) => Promise<{ videoId: string }> } | null;
  drive: { uploadBuffer: (opts: { bytes: Buffer; name: string; folderId: string; mimeType: string }) => Promise<{ fileId: string; webViewLink?: string }> } | null;
};

// Formalized (capability, provider) dispatch (Sprint 1 PR 4 — see packages/integrations/src/
// renderer.ts and docs/atelier/renderer-boundary.md). HeyGen's `aroll` path stays a direct
// client call, unchanged — only the previously ad-hoc broll/audio/thumbnail/default stubs are
// now routed through a Renderer (NullRenderer), which reproduces their exact prior output.
// Exported only for the dispatch-behavior tests (apps/gateway/test/worker.test.ts) — not a
// new public surface for other modules to call.
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
      talkingPhotoId?: string;
      audioUrl?: string;
      useAvatarIv?: boolean;
      customMotionPrompt?: string;
      dimension?: { width: number; height: number };
      title?: string;
    };
    if (!p.talkingPhotoId || !p.audioUrl) throw new Error('aroll payload missing talkingPhotoId or audioUrl');
    const { videoId } = await client.generateVideo({
      talkingPhotoId: p.talkingPhotoId,
      audioUrl: p.audioUrl,
      useAvatarIv: p.useAvatarIv ?? true,
      customMotionPrompt: p.customMotionPrompt,
      dimension: p.dimension ?? { width: 720, height: 1280 },
      title: p.title,
    });
    return { resultId: videoId };
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

export function registerWorkerRoutes(
  app: FastifyInstance,
  db: Database,
  clients: WorkerClients = { heygen: null, drive: null },
  renderers: RendererRegistry = createDefaultRendererRegistry()
) {
  // POST /worker/recover — sweep abandoned jobs (running rows whose lease expired).
  // Exposed separately so an operator can run recovery without also claiming work.
  app.post('/worker/recover', async (request, reply) => {
    const secret = (request.headers['x-worker-secret'] as string | undefined) ?? '';
    if (WORKER_SECRET && secret !== WORKER_SECRET) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const recovered = await recoverStaleJobs(db);
    return { recovered };
  });

  // POST /worker/tick — claim and execute the next queued job.
  app.post('/worker/tick', async (request, reply) => {
    const secret = (request.headers['x-worker-secret'] as string | undefined) ?? '';
    if (WORKER_SECRET && secret !== WORKER_SECRET) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    // Sweep abandoned work first, so a job stranded by a crashed worker becomes runnable (or
    // visibly failed) instead of sitting in `running` forever with nothing to move it.
    const recovered = await recoverStaleJobs(db);

    // Atomic claim: one statement, FOR UPDATE SKIP LOCKED. Two concurrent ticks cannot both
    // receive this row — which is what previously allowed a duplicated paid render.
    const job = await claimNextJob(db, WORKER_ID, LEASE_SECONDS);
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
  });
}
