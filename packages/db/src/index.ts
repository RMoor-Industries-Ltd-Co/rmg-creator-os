export { createDb, schema } from './client.js';
export type { Database } from './client.js';
export { runMigrations } from './migrate.js';
export * as tables from './schema.js';
// Re-export common query helpers so services don't depend on drizzle-orm directly.
export { and, asc, desc, eq, or, sql } from 'drizzle-orm';
export {
  enqueueJob,
  claimNextJob,
  recoverStaleJobs,
  findCompletedByIdempotencyKey,
  cancelJob,
  listAwaitingApproval,
  DEFAULT_LEASE_SECONDS
} from './queue.js';
export type {
  EnqueueJobInput,
  EnqueueResult,
  StaleRecovery,
  CancelOutcome,
  AwaitingApprovalEntry
} from './queue.js';
export { computeProductionDigest, computeAccordPackageDigest } from './digest.js';
export type {
  ProductionDigestInput,
  AccordPackageDigestInput,
  OutboundPackage,
  OutboundPost,
  PinnedVideo
} from './digest.js';
export {
  computeLegacyApprovalEvidenceRows,
  backfillLegacyApprovals,
  LEGACY_PRINCIPAL_ID,
  LEGACY_ASSERTED_ROLE,
  LEGACY_REVISION_DIGEST,
  LEGACY_SOURCE_SYSTEM
} from './legacyApprovalBackfill.js';
export type {
  LegacyApprovalMapInput,
  LegacyApprovalEvidenceRow,
  BackfillResult
} from './legacyApprovalBackfill.js';
export { recordWorkflowTransition } from './transitions.js';
export type { RecordWorkflowTransitionInput, PrincipalKind } from './transitions.js';
