import postgres from 'postgres';

// One-off repair for cross-portal corruption: memberships in "Test Olympiad"
// (10cff7d3-...) pointed at "Random School" (5775db39-...), a school row that
// belongs to "Invite Email Test Olympiad" (c30a5dd7-...). Creates Test
// Olympiad's own school row with the same name and repoints its memberships.
const sql = postgres(
  'postgresql://postgres.qqflfsajwpusjetctpgj:LspyyGJjv1EPnuKZ@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  { prepare: false }
);

const TEST_PORTAL = '10cff7d3-fd61-4b08-b81d-aef43d8a65f1';
const FOREIGN_SCHOOL = '5775db39-730d-444e-975e-c07d4ed9955a';

const [newSchool] = await sql`
  insert into schools (portal_id, name)
  values (${TEST_PORTAL}, 'Random School')
  returning id, name`;

console.log('Created school:', newSchool.id, '|', newSchool.name);

const repointed = await sql`
  update memberships
  set school_id = ${newSchool.id}
  where portal_id = ${TEST_PORTAL}
    and school_id = ${FOREIGN_SCHOOL}
  returning id, role, invited_email`;

console.log(`Repointed ${repointed.length} membership(s):`);
for (const m of repointed) console.log(' -', m.role, m.invited_email);

const remaining = await sql`
  select count(*)::int as total
  from memberships m
  join schools s on s.id = m.school_id
  where m.school_id is not null and s.portal_id <> m.portal_id`;

console.log('Remaining cross-portal memberships:', remaining[0].total);

await sql.end();
