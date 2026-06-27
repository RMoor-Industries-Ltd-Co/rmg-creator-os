// apps/gateway/src/worker.ts
// Worker tick — claims and executes the next queued production job.

import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from '@rmg-creator-os/db';
import { tables } from '@rmg-creator-os/db';
import type { Database } from '@rmg-creator-os/db';

const WORKER_SECRET = process.env.WORKER_SECRET ?? '';

type ProductionJob = typeof tables.productionJobs.$inferSelect;

/** Stub dispatcher — logs and returns a result id. Replace with real dispatch logic. */
async function dispatch(job: ProductionJob): Promise<{ resultId: string }> {
  console.log(`[worker] dispatching job ${job.id} capability=${job.capability} provider=${job.provider}`);
  return { resultId: 'stub-' + job.id };
}

export function registerWorkerRoutes(app: FastifyInstance, db: Database) {
  // POST /worker/tick — claim and execute the next queued job.
  app.post('/worker/tick', async (request, reply) => {
    const secret = (request.headers['x-worker-secret'] as string | undefined) ?? '';
    if (WORKER_SECRET && secret !== WORKER_SECRET) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    // Claim the next queued job (lowest priority, then oldest enqueued_at).
    const [job] = await db
      .select()
      .from(tables.productionJobs)
      .where(
        and(
          eq(tables.productionJobs.status, 'queued'),
          sql`(${tables.productionJobs.lockedUntil} IS NULL OR ${tables.productionJobs.lockedUntil} < now())`
        )
      )
      .orderBy(tables.productionJobs.priority, tables.productionJobs.enqueuedAt)
      .limit(1);

    if (!job) {
      return { claimed: false };
    }

    // Mark running.
    await db
      .update(tables.productionJobs)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(tables.productionJobs.id, job.id));

    try {
      const { resultId } = await dispatch(job);
      await db
        .update(tables.productionJobs)
        .set({ status: 'done', resultId, completedAt: new Date() })
        .where(eq(tables.productionJobs.id, job.id));
      return { claimed: true, jobId: job.id, status: 'done', resultId };
    } catch (err) {
      const nextAttempt = (job.attempt ?? 0) + 1;
      const maxAttempts = job.maxAttempts ?? 2;
      if (nextAttempt < maxAttempts) {
        const backoffSecs = nextAttempt * 30;
        const lockedUntil = new Date(Date.now() + backoffSecs * 1000);
        await db
          .update(tables.productionJobs)
          .set({ status: 'queued', attempt: nextAttempt, lockedUntil })
          .where(eq(tables.productionJobs.id, job.id));
        return { claimed: true, jobId: job.id, status: 'requeued', attempt: nextAttempt };
      } else {
        const error = (err as Error).message;
        await db
          .update(tables.productionJobs)
          .set({ status: 'failed', error, completedAt: new Date() })
          .where(eq(tables.productionJobs.id, job.id));
        return { claimed: true, jobId: job.id, status: 'failed', error };
      }
    }
  });
}
