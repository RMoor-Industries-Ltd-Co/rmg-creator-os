CREATE TABLE IF NOT EXISTS "allen_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" text,
	"content" text NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "allen_memories_brand_idx" ON "allen_memories" ("brand");
