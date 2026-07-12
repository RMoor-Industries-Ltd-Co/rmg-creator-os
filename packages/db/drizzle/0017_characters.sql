-- Reusable AI Characters — a Higgsfield Soul 2.0 identity (soul_id) plus a rendered
-- portrait still. A character is bound to a production (productions.character_id) so the
-- same identity stays consistent across A-Roll (talking-head portrait) and B-Roll
-- (silent Soul-conditioned scenes).
CREATE TABLE IF NOT EXISTS characters (
  id                  text PRIMARY KEY,
  brand               text NOT NULL,
  name                text NOT NULL,
  soul_id             text,
  soul_model          text NOT NULL DEFAULT 'soul_2',
  portrait_asset_id   text,
  reference_asset_ids jsonb NOT NULL DEFAULT '[]',
  status              text NOT NULL DEFAULT 'ready',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE productions
  ADD COLUMN IF NOT EXISTS character_id text;
