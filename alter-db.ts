import { db } from './src/lib/db/index';
import { sql } from 'drizzle-orm';

async function main() {
  try {
    await db.execute(sql`ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_delivery_method_check;`);
    console.log("Constraint dropped.");
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}

main();
