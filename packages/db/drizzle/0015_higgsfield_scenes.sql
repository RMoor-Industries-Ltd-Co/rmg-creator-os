-- Persist Higgsfield multi-scene compositions and asset shortlist to DB
-- so they survive browser/device switches instead of living in localStorage.
ALTER TABLE productions
  ADD COLUMN IF NOT EXISTS higgsfield_scenes  jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS higgsfield_shortlist jsonb NOT NULL DEFAULT '[]';
