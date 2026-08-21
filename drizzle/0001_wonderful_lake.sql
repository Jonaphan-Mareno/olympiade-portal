ALTER TABLE "schools" ADD COLUMN "portal_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organiser_applications" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "organiser_applications" DROP COLUMN "previous_olympiads";--> statement-breakpoint
ALTER TABLE "organiser_applications" DROP COLUMN "credibility";