import { config } from 'dotenv';
config({ path: '.env.local' });
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { submissions, results, examSittings, studentAnswers } from './src/lib/db/schema';
import { sql } from 'drizzle-orm';

const connectionString = process.env.DATABASE_URL!;
const queryClient = postgres(connectionString, { prepare: false });
const db = drizzle(queryClient);

async function main() {
  console.log('Cleaning up database...');
  try {
    await db.delete(studentAnswers);
    await db.delete(examSittings);
    await db.delete(results);
    await db.delete(submissions);
    console.log('Successfully deleted all submissions and related tables.');
  } catch (err) {
    console.error('Error cleaning up DB:', err);
  }
  process.exit(0);
}

main();
