CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"production_id" text NOT NULL,
	"kind" text DEFAULT 'image' NOT NULL,
	"role" text DEFAULT 'source' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" text,
	"drive_file_id" text,
	"drive_link" text,
	"status" text DEFAULT 'stored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_production_id_productions_id_fk" FOREIGN KEY ("production_id") REFERENCES "public"."productions"("id") ON DELETE cascade ON UPDATE no action;
