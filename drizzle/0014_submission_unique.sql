-- 0014_submission_unique — enforce one submission per entrant per round.
-- Converts the plain lookup index into a UNIQUE index so the two routes into
-- "submissions" (the online sitting submit and the educator's offline bulk
-- marks) can never leave a hybrid-round entrant with two rows. round-stats
-- counts marks per result row (not per student), so a duplicate submission
-- would silently skew the average and "marked" counts even though the
-- headcounts dedupe by membership id.
--
-- student_membership_id is nullable; Postgres treats NULLs as distinct in a
-- unique index, so anonymous rows never collide.
--
-- IMPORTANT: if pre-existing duplicate (student_membership_id, round_id) rows
-- exist, the CREATE UNIQUE INDEX below will fail. De-duplicate first (keep the
-- earliest submitted row per pair) before applying, or split the DROP/CREATE
-- into a follow-up migration.
DROP INDEX "submissions_student_round_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_student_round_uniq" ON "submissions" USING btree ("student_membership_id","round_id");
