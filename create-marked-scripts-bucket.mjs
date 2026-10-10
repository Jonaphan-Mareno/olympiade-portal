// Creates the PRIVATE `marked-scripts` Storage bucket (idempotent).
//
// Marked paper scripts are minors' exam work, so the bucket is private and
// gets NO storage.objects policies: nothing can read or write it with the anon
// key. The app reaches it only server-side with SUPABASE_SERVICE_ROLE_KEY
// (signed one-off upload URLs, and /api/scripts/[pageId] for viewing).
//
// Usage: DATABASE_URL must be set (read from the environment or .env.local).
//   node create-marked-scripts-bucket.mjs
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ path: '.env.local' });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const sql = postgres(url, { prepare: false });

  try {
    // 10 MB per page and images only, enforced by Storage as well as the app.
    // Re-running tightens an existing bucket back to private with these limits.
    await sql.unsafe(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('marked-scripts', 'marked-scripts', false, 10485760,
              ARRAY['image/jpeg', 'image/png', 'image/webp'])
      ON CONFLICT (id) DO UPDATE
        SET public = false,
            file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types;
    `);
    console.log('Private bucket marked-scripts ensured.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  }

  await sql.end();
}

main();
