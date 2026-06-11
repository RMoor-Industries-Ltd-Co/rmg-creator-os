CREATE TABLE IF NOT EXISTS "transcripts" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"brand" text,
	"transcript" text NOT NULL,
	"summary" text,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_sec" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
