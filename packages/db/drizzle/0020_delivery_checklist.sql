-- My Poster manual pre-post checklist (Phase C): logo-in-viewport, transitions verified,
-- brand-safe, etc. Automatic checks (caption/length/cover/duration) are computed at render time.
ALTER TABLE productions ADD COLUMN IF NOT EXISTS delivery_checklist jsonb DEFAULT '{}';
