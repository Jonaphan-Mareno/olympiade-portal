UPDATE "rounds" SET "qualifying_threshold" = '0' WHERE "qualifying_threshold" IS NULL;--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "qualifying_threshold" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "qualifying_threshold" SET NOT NULL;