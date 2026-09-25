CREATE TABLE "certificate_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"min_score_percentage" numeric NOT NULL,
	"template_url" text NOT NULL,
	"name_x_coord" numeric NOT NULL,
	"name_y_coord" numeric NOT NULL,
	"name_font_size" integer DEFAULT 48 NOT NULL,
	"name_text_color" text DEFAULT '#000000' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_app_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"link_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "remark_reason" text;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "remark_outcome" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "certificate_template_url" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "name_x_coord" numeric;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "name_y_coord" numeric;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "name_font_size" integer DEFAULT 48;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "name_text_color" text DEFAULT '#000000';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "school_id" uuid;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;