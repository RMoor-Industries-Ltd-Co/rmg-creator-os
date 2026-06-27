-- Ad Index: unique code per approved production (type-product-region-tz-version)
DO $$ BEGIN
  CREATE TYPE ad_index_status AS ENUM ('draft', 'approved', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ad_index (
  code            text PRIMARY KEY,          -- e.g. vlog-software-news-usa-est-001
  type            text NOT NULL,             -- vlog | ad | short | long | promo | podcast
  product         text NOT NULL,             -- books | software | merch | store | news
  region          text NOT NULL,             -- usa | can | uk | global
  tz              text NOT NULL,             -- est | pst | cst | gmt | utc
  version         int  NOT NULL,             -- 1, 2, 3 …
  production_id   text REFERENCES productions(id) ON DELETE SET NULL,
  status          ad_index_status NOT NULL DEFAULT 'draft',
  final_drive_id  text,
  poster_drive_id text,
  approved_at     timestamptz,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ad_index_slug ON ad_index (type, product, region, tz);

-- Productions: delivery fields
ALTER TABLE productions
  ADD COLUMN IF NOT EXISTS ad_index_code    text REFERENCES ad_index(code) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS final_video_id   text,
  ADD COLUMN IF NOT EXISTS thumbnail_drive_id text,
  ADD COLUMN IF NOT EXISTS broll_scenes     jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS broll_library    jsonb DEFAULT '[]'::jsonb;
