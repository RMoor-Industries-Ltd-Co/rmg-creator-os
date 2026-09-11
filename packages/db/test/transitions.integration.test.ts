import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import * as tables from '../src/schema.js';
import { recordWorkflowTransition } from '../src/transitions.js';
import type { Database } from '../src/client.js';
import { provisionDatabase } from './support/database.js';

/**
 * Drizzle wraps driver errors, so `.message` is only "Failed query: ...". The PostgreSQL
 * message (the trigger's RAISE text) is on `.cause` — same helper shape as
 * governance.migration.test.ts's `refused()`, kept local since this is the only place in this
 * file that needs it.
 */
async function refused(run: () => Promise<unknown>, match: RegExp): Promise<void> {
  let err: unknown;
  try {
    await run();
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the statement to be refused, but it succeeded').toBeDefined();
  const cause = (err as { cause?: { message?: string } })?.cause;
  const text = `${(err as Error).message} ${cause?.message ?? ''}`;
  expect(text).toMatch(match);
}

// workflow_transitions write helper (docs/atelier/phase-b-governance-primitives-design.md §3.3,
// §13 step 9). The table, its append-only trigger and its evidence-coherence trigger already
// shipped in B1.1 and are unit-tested directly in governance.migration.test.ts; what these tests
// prove is the property THIS module exists for — that passing the same transaction handle to
// both the state-changing write and recordWorkflowTransition makes them commit or roll back
// together, per §3.3: "The state change and its transition row commit together, or neither does."
//
// Every table this suite touches is append-only (workflow_transitions, approval_evidence), so
// there is no DELETE-based cleanup between tests — each test creates its OWN production row with
// a fresh id instead, and scopes every assertion to that id. Sharing rows across tests here would
// be the wrong fix for the wrong reason: the append-only trigger is exactly what production
// depends on, so a test suite that routes around it isn't testing the real shape.
const DB_URL = process.env.TEST_DATABASE_URL;
const d = DB_URL ? describe : describe.skip;

d('recordWorkflowTransition — real Postgres', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    const url = await provisionDatabase('transitions');
    pool = new Pool({ connectionString: url ?? DB_URL });
    db = drizzle(pool, { schema: tables }) as unknown as Database;
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  async function newProduction(): Promise<string> {
    const id = `prod-transitions-${randomUUID()}`;
    await db.execute(sql`INSERT INTO productions (id, brand, topic, status) VALUES (${id}, 'hvn', 'test topic', 'draft')`);
    return id;
  }

  function baseInputFor(prodId: string) {
    return {
      subjectType: 'production',
      subjectId: prodId,
      fromState: 'draft',
      toState: 'active',
      principalId: 'ops-processor',
      principalKind: 'processor' as const,
      assertedRole: 'operator',
      sourceSystem: 'rmg-creator-os'
    };
  }

  it('inserts a transition row with the given shape', async () => {
    const prodId = await newProduction();
    const row = await recordWorkflowTransition(db, baseInputFor(prodId));
    expect(row).toMatchObject({
      subjectType: 'production',
      subjectId: prodId,
      fromState: 'draft',
      toState: 'active',
      principalId: 'ops-processor',
      principalKind: 'processor',
      assertedRole: 'operator',
      sourceSystem: 'rmg-creator-os'
    });
    expect(row.id).toBeTruthy();
    expect(row.occurredAt).toBeInstanceOf(Date);
  });

  it('defaults reason/evidenceId to null and authContext to {}', async () => {
    const prodId = await newProduction();
    const row = await recordWorkflowTransition(db, baseInputFor(prodId));
    expect(row.reason).toBeNull();
    expect(row.evidenceId).toBeNull();
    expect(row.authContext).toEqual({});
  });

  it('commits the state change and the transition together when both succeed in one transaction', async () => {
    const prodId = await newProduction();
    await db.transaction(async (tx) => {
      await tx.update(tables.productions).set({ status: 'active' }).where(eq(tables.productions.id, prodId));
      await recordWorkflowTransition(tx, baseInputFor(prodId));
    });

    const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, prodId));
    expect(prod?.status).toBe('active');

    const transitions = await db
      .select()
      .from(tables.workflowTransitions)
      .where(eq(tables.workflowTransitions.subjectId, prodId));
    expect(transitions).toHaveLength(1);
  });

  it('rolls back the state change too when the transition insert is refused inside the same transaction', async () => {
    // The database enforces the coherence rule: evidence must be about THIS subject. Insert
    // evidence for a DIFFERENT production, then try to cite it on a transition for this one —
    // the trigger must refuse it, and per §3.3 that refusal must take the accompanying state
    // write down with it.
    const prodId = await newProduction();
    const otherProdId = await newProduction();

    const [otherEvidence] = await db
      .insert(tables.approvalEvidence)
      .values({
        subjectType: 'production',
        subjectId: otherProdId,
        scope: 'hvn',
        revisionDigest: 'sha256:whatever',
        decision: 'approved',
        principalId: 'someone',
        principalKind: 'processor',
        assertedRole: 'operator',
        sourceSystem: 'rmg-creator-os',
        approvedPackage: { fake: true },
        decisionSeq: 0,
        decidedAt: new Date()
      })
      .returning();

    await expect(
      db.transaction(async (tx) => {
        await tx.update(tables.productions).set({ status: 'active' }).where(eq(tables.productions.id, prodId));
        await recordWorkflowTransition(tx, { ...baseInputFor(prodId), evidenceId: otherEvidence!.id });
      })
    ).rejects.toThrow();

    const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, prodId));
    expect(prod?.status).toBe('draft'); // the state write did NOT survive the rollback

    const transitions = await db
      .select()
      .from(tables.workflowTransitions)
      .where(eq(tables.workflowTransitions.subjectId, prodId));
    expect(transitions).toHaveLength(0); // and no transition row was left behind either
  });

  it('accepts evidence that genuinely is about the same subject', async () => {
    const prodId = await newProduction();
    const [evidence] = await db
      .insert(tables.approvalEvidence)
      .values({
        subjectType: 'production',
        subjectId: prodId,
        scope: 'hvn',
        revisionDigest: 'sha256:whatever',
        decision: 'approved',
        principalId: 'someone',
        principalKind: 'human',
        assertedRole: 'founder',
        sourceSystem: 'rmg-creator-os',
        approvedPackage: { fake: true },
        decisionSeq: 0,
        decidedAt: new Date()
      })
      .returning();

    const row = await recordWorkflowTransition(db, { ...baseInputFor(prodId), evidenceId: evidence!.id });
    expect(row.evidenceId).toBe(evidence!.id);
  });

  it('a transition row can never be updated or deleted (append-only, already enforced at the database)', async () => {
    const prodId = await newProduction();
    const row = await recordWorkflowTransition(db, baseInputFor(prodId));
    await refused(
      () => db.update(tables.workflowTransitions).set({ toState: 'tampered' }).where(eq(tables.workflowTransitions.id, row.id)),
      /append-only/
    );
    await refused(
      () => db.delete(tables.workflowTransitions).where(eq(tables.workflowTransitions.id, row.id)),
      /append-only/
    );
  });
});
