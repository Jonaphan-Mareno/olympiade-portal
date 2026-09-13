CREATE TABLE "exam_sittings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_membership_id" uuid NOT NULL,
	"question_paper_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sitting_id" uuid NOT NULL,
	"question_number" integer NOT NULL,
	"answer_value" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_answers_sitting_id_question_number_unique" UNIQUE("sitting_id","question_number")
);
--> statement-breakpoint
ALTER TABLE "question_papers" ADD COLUMN "duration_minutes" integer DEFAULT 60;--> statement-breakpoint
ALTER TABLE "exam_sittings" ADD CONSTRAINT "exam_sittings_student_membership_id_memberships_id_fk" FOREIGN KEY ("student_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sittings" ADD CONSTRAINT "exam_sittings_question_paper_id_question_papers_id_fk" FOREIGN KEY ("question_paper_id") REFERENCES "public"."question_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_sitting_id_exam_sittings_id_fk" FOREIGN KEY ("sitting_id") REFERENCES "public"."exam_sittings"("id") ON DELETE cascade ON UPDATE no action;