CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_offset_minutes" integer DEFAULT 0 NOT NULL,
	"conditions" jsonb,
	"template_subject" text NOT NULL,
	"template_html" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"student_membership_id" uuid NOT NULL,
	"qualified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_qualifications_round_id_student_membership_id_unique" UNIQUE("round_id","student_membership_id")
);
--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "threshold_top_n" integer;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_qualifications" ADD CONSTRAINT "round_qualifications_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_qualifications" ADD CONSTRAINT "round_qualifications_student_membership_id_memberships_id_fk" FOREIGN KEY ("student_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;