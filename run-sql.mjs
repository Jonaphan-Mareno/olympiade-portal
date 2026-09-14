import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

async function main() {
  const sql = postgres(
    'postgresql://postgres.qqflfsajwpusjetctpgj:LspyyGJjv1EPnuKZ@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'
  );

  const migration = fs.readFileSync(
    path.join(process.cwd(), 'drizzle', '0005_regular_leper_queen.sql'),
    'utf-8'
  );
  const statements = migration.split('--> statement-breakpoint');

  for (const stmt of statements) {
    if (stmt.trim()) {
      console.log('Executing:', stmt.trim().substring(0, 50) + '...');
      try {
        await sql.unsafe(stmt.trim());
        console.log('Success.');
      } catch (e) {
        console.error('Error:', e.message);
      }
    }
  }

  await sql.end();
}

main();
