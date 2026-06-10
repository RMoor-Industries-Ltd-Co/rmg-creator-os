CREATE TABLE IF NOT EXISTS "brand_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"kind" text DEFAULT 'rss' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_feeds_brand_idx" ON "brand_feeds" ("brand");
