const fs = require('fs');
const { Client } = require('pg');

const envFile = fs.readFileSync('.env.local', 'utf8');
const dbUrl = envFile.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].trim();

const client = new Client({ connectionString: dbUrl });

async function run() {
  await client.connect();
  const res = await client.query("select cmd, roles, qual, with_check from pg_policies where schemaname='storage' and tablename='objects'");
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run();
