-- Contract 06 — My Poster: per-brand delivery approval state
ALTER TABLE productions
  ADD COLUMN IF NOT EXISTS delivery_approvals jsonb DEFAULT '{}'::jsonb;
