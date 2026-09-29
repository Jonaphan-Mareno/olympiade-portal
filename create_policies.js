const fs = require('fs');
const { Client } = require('pg');

const envFile = fs.readFileSync('.env.local', 'utf8');
const dbUrl = envFile.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();

const client = new Client({ connectionString: dbUrl });

async function run() {
  await client.connect();
  
  await client.query(`
    CREATE POLICY "Authenticated users can upload round-documents" 
    ON storage.objects 
    FOR INSERT 
    TO public 
    WITH CHECK (bucket_id = 'round-documents' AND auth.role() = 'authenticated');
  `);
  
  await client.query(`
    CREATE POLICY "Public access to round-documents" 
    ON storage.objects 
    FOR SELECT 
    TO public 
    USING (bucket_id = 'round-documents');
  `);

  console.log("Policies created successfully.");
  await client.end();
}
run();
