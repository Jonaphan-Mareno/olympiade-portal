CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"question_type" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"correct_answer" jsonb,
	"marks" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_answers" DROP CONSTRAINT "student_answers_sitting_id_question_number_unique";--> statement-breakpoint
ALTER TABLE "student_answers" ALTER COLUMN "question_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "delivery_method" text DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_answers" ADD COLUMN "question_id" uuid;--> statement-breakpoint
ALTER TABLE "student_answers" ADD COLUMN "manual_score" numeric;--> statement-breakpoint
ALTER TABLE "student_answers" ADD COLUMN "educator_feedback" text;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_sitting_id_question_id_unique" UNIQUE("sitting_id","question_id");