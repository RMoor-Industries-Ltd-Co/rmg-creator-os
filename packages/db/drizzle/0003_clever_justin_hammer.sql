CREATE TABLE "productions" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" text NOT NULL,
	"persona" text,
	"output_kind" text DEFAULT 'post' NOT NULL,
	"topic" text NOT NULL,
	"context" text,
	"title" text,
	"script_text" text,
	"script_doc_id" text,
	"script_doc_url" text,
	"script_status" text DEFAULT 'draft' NOT NULL,
	"model" text,
	"stage" text DEFAULT 'script' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
