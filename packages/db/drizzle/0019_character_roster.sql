-- Production character roster (Phase B): the cast of Soul-backed characters that can be
-- assigned per A-Roll segment or per Higgsfield scene. productions.character_id remains the default.
ALTER TABLE productions ADD COLUMN IF NOT EXISTS character_ids jsonb NOT NULL DEFAULT '[]';
