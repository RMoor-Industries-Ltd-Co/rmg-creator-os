ALTER TABLE "productions" ADD COLUMN "voice_brand" text;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "tagged_script" text;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "stability_mode" text;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "stability" real;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "audio_tag_palette" text;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "intensity" text;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "voice_id" text;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "emotion_locked" boolean DEFAULT false NOT NULL;
