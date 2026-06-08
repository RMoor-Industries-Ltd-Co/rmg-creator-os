CREATE TABLE "brand_post_defaults" (
	"brand" text PRIMARY KEY NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hashtag_style" text,
	"audience" text,
	"first_comment_template" text,
	"cadence" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"production_id" text NOT NULL,
	"brand" text NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text,
	"caption" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_comment" text,
	"cover_asset_id" text,
	"switches" jsonb,
	"schedule_at" timestamp with time zone,
	"post_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;
