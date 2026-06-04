ALTER TABLE "videos" ADD COLUMN "source" text DEFAULT 'heygen' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "config" jsonb;
