// workflow_transitions — attributed, append-only state-change history
// (docs/atelier/phase-b-governance-primitives-design.md §3.3, §13 step 9). The table, its
// append-only trigger, and its evidence-coherence trigger already shipped in B1.1 (migration
// 0024) and are exercised directly in packages/db/test/governance.migration.test.ts. What did
// not yet exist is a typed, reusable write helper application code can actually call — this
// module is that helper.
//
// **The state change and its transition row commit together, or neither does** (§3.3). This
// function is deliberately typed to accept either `Database` or a transaction handle
// (`db.transaction(async (tx) => ...)`), so a caller gets that guarantee for free by passing the
// SAME `tx` it used for the state-changing write — never a fresh `db` reference, which would
// open a second, independent transaction and defeat the whole point. There is no live
// state-changing write path in this repo yet that needs to call it (§13 step 6, the write
// boundary this exists for, stays blocked on the A-Roll pin — see
// docs/atelier/b1-2-dependency-split.md), so this ships as a tested primitive ahead of its one
// blocked caller, the same shape digest.ts (step 2), stepup.ts (step 3) and founder.ts (step 4)
// did.

import type { Database } from './client.js';
import * as tables from './schema.js';
import type { principalKind } from './schema.js';

export type PrincipalKind = (typeof principalKind.enumValues)[number];

export interface RecordWorkflowTransitionInput {
  subjectType: string;
  subjectId: string;
  /** `null` for a creation transition — there is no prior state to name. */
  fromState: string | null;
  toState: string;
  reason?: string | null;
  /** Must be about the SAME (subjectType, subjectId) — enforced at the database by
   *  `workflow_transitions_evidence_coherent`, not re-validated here, so this function cannot
   *  silently diverge from what the trigger actually enforces. */
  evidenceId?: string | null;
  principalId: string;
  principalKind: PrincipalKind;
  /** Required on every row, including one with no `evidenceId` — an unlinked transition still
   *  needs an answer to "under what authority" (§3.3). The database's `transition_founder_is_human`
   *  CHECK is defense in depth, not authorization: it accepts a caller that merely LABELS itself
   *  'founder'/'human', so this function does not attempt to derive or validate the claim —
   *  callers must pass an already-authorized value. */
  assertedRole: string;
  sourceSystem: string;
  authContext?: Record<string, unknown>;
}

/** Structural subset of `Database` this module needs — satisfied by both the top-level `db` and
 *  a `db.transaction(async (tx) => ...)` callback's `tx`, so the same function works whichever
 *  one a caller passes. */
type Insertable = Pick<Database, 'insert'>;

/**
 * Insert one `workflow_transitions` row. Pass the SAME transaction handle used for the
 * accompanying state-changing write (see the module doc comment) — this function does not open
 * its own transaction, so calling it with a bare `db` alongside a separate, unrelated write gives
 * up the atomicity guarantee entirely.
 */
export async function recordWorkflowTransition(db: Insertable, input: RecordWorkflowTransitionInput) {
  const [row] = await db
    .insert(tables.workflowTransitions)
    .values({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      fromState: input.fromState,
      toState: input.toState,
      reason: input.reason ?? null,
      evidenceId: input.evidenceId ?? null,
      principalId: input.principalId,
      principalKind: input.principalKind,
      assertedRole: input.assertedRole,
      sourceSystem: input.sourceSystem,
      authContext: input.authContext ?? {}
    })
    .returning();
  return row;
}
