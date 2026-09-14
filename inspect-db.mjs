import postgres from 'postgres';

// Read-only diagnostic: dump portals, schools and memberships to inspect
// cross-portal data corruption from the unscoped schools search.
const sql = postgres(
  'postgresql://postgres.qqflfsajwpusjetctpgj:LspyyGJjv1EPnuKZ@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  { prepare: false }
);

const portals = await sql`select id, name, status from portals order by created_at`;
console.log('=== PORTALS ===');
for (const p of portals) console.log(p.id, '|', p.name, '|', p.status);

const schools = await sql`
  select s.id, s.name, s.portal_id as "schoolBelongsToPortal",
         p.name as "portalName"
  from schools s join portals p on p.id = s.portal_id
  order by s.created_at`;
console.log('\n=== SCHOOLS (rows) ===');
for (const s of schools)
  console.log(s.id, '|', s.name, '| belongs to:', s.portalName, `(${s.schoolBelongsToPortal})`);

const memberships = await sql`
  select m.id, m.role, m.status, m.invited_email as "invitedEmail",
         m.portal_id as "memberPortal", mp.name as "memberPortalName",
         m.school_id as "memberSchool", ms.name as "schoolName",
         ms.portal_id as "schoolBelongsToPortal", sp.name as "schoolPortalName",
         m.user_id
  from memberships m
  join portals mp on mp.id = m.portal_id
  left join schools ms on ms.id = m.school_id
  left join portals sp on sp.id = ms.portal_id
  order by m.role, m.invited_email`;
console.log('\n=== MEMBERSHIPS ===');
for (const m of memberships) {
  const cross =
    m.memberSchool && m.schoolBelongsToPortal && m.schoolBelongsToPortal !== m.memberPortal
      ? '  <<< CROSS-PORTAL!'
      : '';
  console.log(
    `[${m.role}] ${m.invitedEmail} (${m.status})`,
    '| portal:', m.memberPortalName,
    '| school:', m.schoolName ?? 'NULL',
    '| school belongs to:', m.schoolPortalName ?? 'NULL',
    cross
  );
}

const mismatches = memberships.filter(
  (m) => m.memberSchool && m.schoolBelongsToPortal && m.schoolBelongsToPortal !== m.memberPortal
);
console.log(`\n=== SUMMARY: ${mismatches.length} cross-portal membership(s) ===`);

await sql.end();
