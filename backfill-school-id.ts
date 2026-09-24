import { db } from './src/lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Adding school_id to users...');
  try {
    await db.execute(sql`ALTER TABLE "users" ADD COLUMN "school_id" uuid REFERENCES "schools"("id") ON DELETE SET NULL;`);
    console.log('Column added.');
  } catch (err: any) {
    if (err.message.includes('already exists')) {
      console.log('Column already exists.');
    } else {
      console.error('Error adding column:', err);
    }
  }

  console.log('Backfilling school_id for existing students...');
  
  // The backfill requirement: "Generate a quick script or Drizzle command to backfill existing students with the correct school_id based on their existing Olympiad enrollments"
  await db.execute(sql`
    UPDATE "users"
    SET "school_id" = subquery."school_id"
    FROM (
      SELECT DISTINCT ON ("user_id") "user_id", "school_id"
      FROM "memberships"
      WHERE "role" = 'student' AND "school_id" IS NOT NULL
      ORDER BY "user_id", "claimed_at" DESC
    ) AS subquery
    WHERE "users"."id" = subquery."user_id" AND "users"."school_id" IS NULL;
  `);
  
  console.log('Backfill complete!');
  process.exit(0);
}

main().catch(console.error);
