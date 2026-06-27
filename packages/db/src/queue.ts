import type { Database } from './client.js';
import { productionJobs } from './schema.js';

export type EnqueueJobInput = {
  productionId: string;
  capability: typeof productionJobs.$inferInsert['capability'];
  provider: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
};

/** Insert a new production job into the queue and return the inserted row. */
export async function enqueueJob(db: Database, input: EnqueueJobInput) {
  const [row] = await db
    .insert(productionJobs)
    .values({
      productionId: input.productionId,
      capability: input.capability,
      provider: input.provider,
      payload: input.payload ?? {},
      priority: input.priority ?? 10,
      maxAttempts: input.maxAttempts ?? 2
    })
    .returning();
  return row;
}
