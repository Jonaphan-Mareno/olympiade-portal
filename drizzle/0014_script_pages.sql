-- 0014_script_pages — Marked paper scripts and paper-remark queries.
-- PURELY ADDITIVE: one new table (RLS enabled, deliberately NO policies: it is
-- read and written only through the server `db` client, which owns the table
-- and bypasses RLS; the anon/authenticated PostgREST roles get nothing) plus
-- two nullable columns on remark_requests. Not applied here by design.
-- The private `marked-scripts` Storage bucket is created separately by
-- create-marked-scripts-bucket.mjs.
CREATE TABLE "submission_script_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"remark_request_id" uuid,
	"page_index" integer NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_pages_kind_remark_check" CHECK ((kind = 'original' AND remark_request_id IS NULL) OR (kind = 'remarked' AND remark_request_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "submission_script_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "remark_requests" ADD COLUMN "question_refs" text;--> statement-breakpoint
ALTER TABLE "remark_requests" ADD COLUMN "pins" jsonb;--> statement-breakpoint
ALTER TABLE "submission_script_pages" ADD CONSTRAINT "submission_script_pages_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_script_pages" ADD CONSTRAINT "submission_script_pages_remark_request_id_remark_requests_id_fk" FOREIGN KEY ("remark_request_id") REFERENCES "public"."remark_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_script_pages" ADD CONSTRAINT "submission_script_pages_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "script_pages_original_uniq" ON "submission_script_pages" USING btree ("submission_id","page_index") WHERE kind = 'original';--> statement-breakpoint
CREATE UNIQUE INDEX "script_pages_remarked_uniq" ON "submission_script_pages" USING btree ("submission_id","remark_request_id","page_index") WHERE kind = 'remarked';