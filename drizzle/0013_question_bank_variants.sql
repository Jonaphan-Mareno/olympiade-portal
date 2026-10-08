-- 0013_question_bank_variants — Question-bank variants, difficulty, physical
-- selection & publish guard (T-A foundation).
-- PURELY ADDITIVE: only ADD COLUMN (all nullable) + CREATE INDEX, plus relaxing
-- questions.marks to NULLABLE (DROP NOT NULL preserves every existing value).
-- No rename, no column/table drop, no data loss. Not applied here by design.
ALTER TABLE "questions" ALTER COLUMN "marks" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_sittings" ADD COLUMN "variant_question_ids" jsonb;--> statement-breakpoint
ALTER TABLE "exam_sittings" ADD COLUMN "variant_seed" text;--> statement-breakpoint
ALTER TABLE "question_papers" ADD COLUMN "selected_question_ids" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "difficulty" integer;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "target_total_marks" integer;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "variant_question_ids" jsonb;--> statement-breakpoint
-- Plain (non-unique) covering/lookup indexes first.
-- NOTE: Drizzle's index builder cannot express INCLUDE, so the covering columns
-- (marks, difficulty) are written here by hand; meta/0013_snapshot.json records
-- the plain index. Keep both in sync if the covering set ever changes.
CREATE INDEX "questions_round_idx" ON "questions" USING btree ("round_id") INCLUDE ("marks","difficulty");--> statement-breakpoint
CREATE INDEX "submissions_student_round_idx" ON "submissions" USING btree ("student_membership_id","round_id");--> statement-breakpoint
-- Unique / partial indexes LAST. If either fails to build because of
-- pre-existing duplicate rows, de-duplicate the offending table first (or split
-- these two statements into a follow-up 0014_* migration) before applying.
CREATE UNIQUE INDEX "question_papers_round_uniq" ON "question_papers" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_sittings_active_uniq" ON "exam_sittings" USING btree ("student_membership_id","question_paper_id") WHERE status = 'active';
