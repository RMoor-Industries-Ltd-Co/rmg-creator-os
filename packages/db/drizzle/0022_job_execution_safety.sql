-- Phase A — live execution lane stabilization (Master Atelier).
--
-- Additive only. Every statement is IF NOT EXISTS / IF EXISTS guarded, so this migration is
-- idempotent and safe to apply to a running production database ahead of the code that uses
-- it: an older gateway ignores the new column, and a newer gateway treats a NULL
-- idempotency_key exactly as it treated every job before this migration.

-- Idempotency key. NULL means "no dedupe requested" and stays the default for every existing
-- row, so no historical job changes behavior. The unique index is PARTIAL (WHERE NOT NULL) so
-- the many NULL rows never collide with each other — only real keys are deduplicated.
ALTER TABLE production_jobs ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_idempotency_key_uniq
  ON production_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Stale-lease recovery reads (status, locked_until). The pre-existing
-- production_jobs_status_priority index is partial on status = 'queued', so it cannot serve
-- the recovery sweep, which looks for status = 'running'.
CREATE INDEX IF NOT EXISTS production_jobs_running_lease
  ON production_jobs (locked_until)
  WHERE status = 'running';
