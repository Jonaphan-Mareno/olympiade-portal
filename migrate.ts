import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from './src/lib/db/index';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`
    ALTER TABLE "rounds" ADD COLUMN IF NOT EXISTS "certificate_template_url" text;
    ALTER TABLE "rounds" ADD COLUMN IF NOT EXISTS "name_x_coord" numeric;
    ALTER TABLE "rounds" ADD COLUMN IF NOT EXISTS "name_y_coord" numeric;
    ALTER TABLE "rounds" ADD COLUMN IF NOT EXISTS "name_font_size" integer DEFAULT 48;
    ALTER TABLE "rounds" ADD COLUMN IF NOT EXISTS "name_text_color" text DEFAULT '#000000';
  `);
  console.log('Migration complete');
  process.exit(0);
}

main().catch(console.error);
