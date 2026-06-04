ALTER TABLE "videos" ADD COLUMN "production_id" text;--> statement-breakpoint
ALTER TABLE "videos" ALTER COLUMN "voice_id" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "videos" ALTER COLUMN "input_text" SET DEFAULT '';
