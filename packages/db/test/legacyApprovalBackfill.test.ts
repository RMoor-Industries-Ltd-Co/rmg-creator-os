import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import * as tables from '../src/schema.js';
import {
  backfillLegacyApprovals,
  computeLegacyApprovalEvidenceRows,
  LEGACY_ASSERTED_ROLE,
  LEGACY_REVISION_DIGEST,
  type LegacyApprovalMapInput
} from '../src/legacyApprovalBackfill.js';
import type { Database } from '../src/client.js';
import { provisionDatabase } from './support/database.js';

// Legacy delivery-approvals backfill (docs/atelier/phase-b-governance-primitives-design.md §10,
// §13 step 5; issue #56 item 5). Two properties matter:
//   1. Both 'approved' AND 'rejected' current map entries become evidence — 'pending' does not.
//   2. Once backfilled, the evidence row is immutable history: a later mutation of the still-live
//      `productions.deliveryApprovals` map (via the legacy PATCH route, still live by design —
//      §10's dual-write) must NOT erase or alter it. This is issue #56 item 5's named acceptance
//      test: "a prior rejection survives a later approval."

describe('computeLegacyApprovalEvidenceRows — pure', () => {
  it('backfills an approved entry', () => {
    const rows = computeLegacyApprovalEvidenceRows([{ productionId: 'p1', deliveryApprovals: { hvn: 'approved' } }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subjectType: 'production',
      subjectId: 'p1',
      scope: 'hvn',
      decision: 'approved',
      revisionDigest: LEGACY_REVISION_DIGEST,
      assertedRole: LEGACY_ASSERTED_ROLE,
      principalKind: 'processor',
      decisionSeq: 0,
      decidedAt: null,
      notes: null,
      approvedPackage: null
    });
  });

  it('backfills a rejected entry — the exact gap issue #56 item 5 names', () => {
    const rows = computeLegacyApprovalEvidenceRows([{ productionId: 'p1', deliveryApprovals: { hvn: 'rejected' } }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe('rejected');
  });

  it('skips a pending entry — no decision was made', () => {
    const rows = computeLegacyApprovalEvidenceRows([{ productionId: 'p1', deliveryApprovals: { hvn: 'pending' } }]);
    expect(rows).toHaveLength(0);
  });

  it('skips an unrecognized state value rather than guessing', () => {
    const rows = computeLegacyApprovalEvidenceRows([{ productionId: 'p1', deliveryApprovals: { hvn: 'weird' } }]);
    expect(rows).toHaveLength(0);
  });

  it('handles a null/undefined/empty map', () => {
    const input: LegacyApprovalMapInput[] = [
      { productionId: 'p1', deliveryApprovals: null },
      { productionId: 'p2', deliveryApprovals: undefined },
      { productionId: 'p3', deliveryApprovals: {} }
    ];
    expect(computeLegacyApprovalEvidenceRows(input)).toHaveLength(0);
  });

  it('produces one row per brand for a multi-brand map', () => {
    const rows = computeLegacyApprovalEvidenceRows([
      { productionId: 'p1', deliveryApprovals: { hvn: 'approved', amg: 'rejected', rmi: 'pending' } }
    ]);
    expect(rows.map((r) => [r.scope, r.decision]).sort()).toEqual([
      ['amg', 'rejected'],
      ['hvn', 'approved']
    ]);
  });

  it('is deterministically ordered by productionId then scope', () => {
    const rows = computeLegacyApprovalEvidenceRows([
      { productionId: 'p2', deliveryApprovals: { z: 'approved', a: 'approved' } },
      { productionId: 'p1', deliveryApprovals: { hvn: 'approved' } }
    ]);
    expect(rows.map((r) => [r.subjectId, r.scope])).toEqual([
      ['p1', 'hvn'],
      ['p2', 'a'],
      ['p2', 'z']
    ]);
  });

  it('records provenance naming where the row came from', () => {
    const rows = computeLegacyApprovalEvidenceRows([{ productionId: 'p1', deliveryApprovals: { hvn: 'approved' } }]);
    expect(rows[0]!.provenance).toEqual({ backfilledFrom: 'productions.delivery_approvals', legacyState: 'approved' });
  });
});

const DB_URL = process.env.TEST_DATABASE_URL;
const d = DB_URL ? describe : describe.skip;

d('backfillLegacyApprovals — real Postgres', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    const url = await provisionDatabase('legacy_approval_backfill');
    pool = new Pool({ connectionString: url ?? DB_URL });
    db = drizzle(pool, { schema: tables }) as unknown as Database;
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  async function insertProduction(id: string, deliveryApprovals: Record<string, string>) {
    await db.execute(sql`
      INSERT INTO productions (id, brand, topic, delivery_approvals)
      VALUES (${id}, 'hvn', 'test topic', ${JSON.stringify(deliveryApprovals)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET delivery_approvals = EXCLUDED.delivery_approvals
    `);
  }

  it('inserts evidence for an approved and a rejected production, none for a pending one', async () => {
    await insertProduction('legacy-approved', { hvn: 'approved' });
    await insertProduction('legacy-rejected', { hvn: 'rejected' });
    await insertProduction('legacy-pending', { hvn: 'pending' });

    const result = await backfillLegacyApprovals(db);
    expect(result.inserted).toBeGreaterThanOrEqual(2);

    const rows = await db
      .select()
      .from(tables.approvalEvidence)
      .where(eq(tables.approvalEvidence.subjectType, 'production'));

    const approved = rows.find((r) => r.subjectId === 'legacy-approved');
    const rejected = rows.find((r) => r.subjectId === 'legacy-rejected');
    const pending = rows.find((r) => r.subjectId === 'legacy-pending');

    expect(approved?.decision).toBe('approved');
    expect(rejected?.decision).toBe('rejected');
    expect(pending).toBeUndefined();

    expect(approved?.revisionDigest).toBe(LEGACY_REVISION_DIGEST);
    expect(approved?.assertedRole).toBe(LEGACY_ASSERTED_ROLE);
    expect(approved?.decidedAt).toBeNull();
  });

  it('is idempotent — a second run inserts nothing new for rows already backfilled', async () => {
    await insertProduction('legacy-idempotent', { hvn: 'approved' });
    const first = await backfillLegacyApprovals(db);
    expect(first.inserted).toBeGreaterThanOrEqual(1);

    const second = await backfillLegacyApprovals(db);
    const countAfterSecond = await db
      .select()
      .from(tables.approvalEvidence)
      .where(eq(tables.approvalEvidence.subjectId, 'legacy-idempotent'));
    expect(countAfterSecond).toHaveLength(1);
    expect(second.skippedExisting).toBeGreaterThanOrEqual(1);
  });

  it('issue #56 item 5: a prior rejection survives a later approval', async () => {
    // The exact scenario the acceptance item names: the legacy map is mutable and the PATCH
    // route that writes it stays live (§10's dual-write) — so the CURRENT map value can change
    // out from under a row already recorded as history. Backfilling must have captured the
    // rejection before this mutation, and the append-only trigger must keep it intact after.
    await insertProduction('legacy-then-approved', { hvn: 'rejected' });
    await backfillLegacyApprovals(db);

    const beforeMutation = await db
      .select()
      .from(tables.approvalEvidence)
      .where(eq(tables.approvalEvidence.subjectId, 'legacy-then-approved'));
    expect(beforeMutation).toHaveLength(1);
    expect(beforeMutation[0]!.decision).toBe('rejected');

    // Simulate the still-live legacy PATCH /productions/:id/approvals route overwriting the map.
    await insertProduction('legacy-then-approved', { hvn: 'approved' });

    // The live map now disagrees with the evidence row — that is the point. A second backfill
    // pass (idempotent, would run again on the next boot) must not touch the existing row.
    const rerun = await backfillLegacyApprovals(db);
    expect(rerun.skippedExisting).toBeGreaterThanOrEqual(1);

    const afterMutation = await db
      .select()
      .from(tables.approvalEvidence)
      .where(eq(tables.approvalEvidence.subjectId, 'legacy-then-approved'));
    expect(afterMutation).toHaveLength(1);
    expect(afterMutation[0]!.decision).toBe('rejected');
    expect(afterMutation[0]!.id).toBe(beforeMutation[0]!.id);
  });

  it('never produces two live evidence rows for the same (subject, scope) — the index would refuse it', async () => {
    // Insert the legacy row directly, then confirm the unique partial index actually protects
    // this: an attempted second live insert for the same (subjectType, subjectId, scope) fails.
    await insertProduction('legacy-collision', { hvn: 'approved' });
    await backfillLegacyApprovals(db);

    await expect(
      db.insert(tables.approvalEvidence).values({
        subjectType: 'production',
        subjectId: 'legacy-collision',
        scope: 'hvn',
        revisionDigest: 'sha256:something-else',
        decision: 'approved',
        principalId: 'someone',
        principalKind: 'processor',
        assertedRole: 'not-founder',
        sourceSystem: 'rmg-creator-os',
        approvedPackage: { fake: true },
        decisionSeq: 1
      })
    ).rejects.toThrow();
  });
});
