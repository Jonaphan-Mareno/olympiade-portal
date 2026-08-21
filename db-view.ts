import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as schema from './src/lib/db/schema';
dotenv.config({ path: '.env.local' });

const sql = postgres(process.env.DATABASE_URL as string, { prepare: false });
const db = drizzle(sql, { schema });

async function main() {
  const table = process.argv[2]?.toLowerCase();

  if (!table || table === 'help') {
    console.log(`
Usage: npx tsx db-view.ts <table>

Tables: users, portals, schools, memberships, rounds, submissions, results, organiser_applications
    `);
    process.exit(0);
  }

  const tableMap: Record<string, any> = {
    users: schema.users,
    portals: schema.portals,
    schools: schema.schools,
    memberships: schema.memberships,
    rounds: schema.rounds,
    submissions: schema.submissions,
    results: schema.results,
    organiser_applications: schema.organiserApplications,
  };

  const target = tableMap[table];
  if (!target) {
    console.log(`Unknown table: "${table}". Available: ${Object.keys(tableMap).join(', ')}`);
    process.exit(1);
  }

  const rows = await db.select().from(target);
  console.log(`\n--- ${table} (${rows.length} rows) ---\n`);

  if (rows.length === 0) {
    console.log('(empty)');
  } else {
    console.table(rows);
  }

  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
