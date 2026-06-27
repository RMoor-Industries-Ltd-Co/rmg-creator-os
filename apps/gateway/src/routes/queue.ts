// apps/gateway/src/routes/queue.ts
// Queue API — list, inspect, cancel, and retry production jobs.

import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from '@rmg-creator-os/db';
import { tables } from '@rmg-creator-os/db';
import type { Database } from '@rmg-creator-os/db';

export function registerQueueRoutes(app: FastifyInstance, db: Database) {
  // GET /queue — list jobs, optional ?production_id=&status=&capability=
  app.get<{
    Querystring: { production_id?: string; status?: string; capability?: string };
  }>('/queue', async (request) => {
    const { production_id, status, capability } = request.query;

    const conditions = [];
    if (production_id) {
      conditions.push(eq(tables.productionJobs.productionId, production_id));
    }
    if (status) {
      // Support comma-separated status values
      const statuses = status.split(',').map((s) => s.trim());
      if (statuses.length === 1) {
        conditions.push(
          eq(
            tables.productionJobs.status,
            statuses[0] as typeof tables.productionJobs.$inferSelect['status']
          )
        );
      } else {
        conditions.push(
          sql`${tables.productionJobs.status} = ANY(ARRAY[${sql.join(
            statuses.map((s) => sql`${s}`),
            sql`, `
          )}]::production_job_status[])`
        );
      }
    }
    if (capability) {
      conditions.push(
        eq(
          tables.productionJobs.capability,
          capability as typeof tables.productionJobs.$inferSelect['capability']
        )
      );
    }

    const jobs =
      conditions.length > 0
        ? await db
            .select()
            .from(tables.productionJobs)
            .where(and(...conditions))
            .orderBy(tables.productionJobs.enqueuedAt)
        : await db
            .select()
            .from(tables.productionJobs)
            .orderBy(tables.productionJobs.enqueuedAt);

    return { jobs };
  });

  // GET /queue/:id — single job
  app.get<{ Params: { id: string } }>('/queue/:id', async (request, reply) => {
    const [job] = await db
      .select()
      .from(tables.productionJobs)
      .where(eq(tables.productionJobs.id, request.params.id));
    if (!job) return reply.code(404).send({ error: 'job not found' });
    return { job };
  });

  // DELETE /queue/:id — cancel a queued job (error if running)
  app.delete<{ Params: { id: string } }>('/queue/:id', async (request, reply) => {
    const [job] = await db
      .select()
      .from(tables.productionJobs)
      .where(eq(tables.productionJobs.id, request.params.id));
    if (!job) return reply.code(404).send({ error: 'job not found' });
    if (job.status === 'running') {
      return reply.code(409).send({ error: 'cannot cancel a running job' });
    }
    await db
      .update(tables.productionJobs)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(tables.productionJobs.id, request.params.id));
    return reply.code(204).send();
  });

  // POST /queue/:id/retry — re-queue a failed job
  app.post<{ Params: { id: string } }>('/queue/:id/retry', async (request, reply) => {
    const [job] = await db
      .select()
      .from(tables.productionJobs)
      .where(eq(tables.productionJobs.id, request.params.id));
    if (!job) return reply.code(404).send({ error: 'job not found' });
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      return reply.code(409).send({ error: 'only failed or cancelled jobs can be retried' });
    }
    const [updated] = await db
      .update(tables.productionJobs)
      .set({
        status: 'queued',
        attempt: 0,
        error: null,
        lockedUntil: null,
        resultId: null,
        startedAt: null,
        completedAt: null
      })
      .where(eq(tables.productionJobs.id, request.params.id))
      .returning();
    return { job: updated };
  });
}
