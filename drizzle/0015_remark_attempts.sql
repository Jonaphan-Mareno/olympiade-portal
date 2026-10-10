-- 0015_remark_attempts — Up to two remark attempts per submission.
-- Replaces the one-remark-per-submission UNIQUE with (submission_id, attempt),
-- adds a partial unique index so a paper never has two pending appeals, and
-- a CHECK limiting attempts to 1..2. Existing rows become attempt 1, so this
-- applies cleanly to current data. The new 'withdrawn' status is a text enum
-- in the app (no DB constraint). Not applied here by design.
ALTER TABLE "remark_requests" DROP CONSTRAINT "remark_requests_submission_id_unique";--> statement-breakpoint
ALTER TABLE "remark_requests" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "remark_requests_submission_attempt_uniq" ON "remark_requests" USING btree ("submission_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "remark_requests_one_pending_uniq" ON "remark_requests" USING btree ("submission_id") WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE "remark_requests" ADD CONSTRAINT "remark_requests_attempt_check" CHECK (attempt BETWEEN 1 AND 2);