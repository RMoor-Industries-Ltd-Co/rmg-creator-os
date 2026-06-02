CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"heygen_video_id" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"avatar_id" text NOT NULL,
	"voice_id" text NOT NULL,
	"input_text" text NOT NULL,
	"title" text,
	"brand" text,
	"video_url" text,
	"thumbnail_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
