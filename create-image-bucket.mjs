import postgres from 'postgres';

async function main() {
  const sql = postgres('postgresql://postgres.qqflfsajwpusjetctpgj:LspyyGJjv1EPnuKZ@aws-1-eu-west-1.pooler.supabase.com:5432/postgres');
  
  try {
    await sql.unsafe(`
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('question-images', 'question-images', true)
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('Bucket question-images ensured.');
  } catch (e) {
    console.error('Error:', e.message);
  }
  
  await sql.end();
}

main();
