import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users, memberships, portals, rounds, schools } from './src/lib/db/schema';
import { eq, and, sql, ilike, or } from 'drizzle-orm';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const connectionString = process.env.DATABASE_URL!;
const queryClient = postgres(connectionString, { prepare: false });
const db = drizzle(queryClient);

async function main() {
  const email = 'teststudent2@gmail.com';
  const password = '111111';

  console.log('1. Creating test student in Supabase Auth...');
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError && authError.message !== 'User already registered') {
    console.error('Error creating user:', authError);
    process.exit(1);
  }

  console.log('Confirming email directly in auth.users...');
  await db.execute(sql`UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = ${email}`);

  const authUserRes = await db.execute(sql`SELECT id FROM auth.users WHERE email = ${email}`);
  if (authUserRes.length === 0) throw new Error('Auth user not found');
  const authUserId = authUserRes[0].id as string;

  console.log('Creating record in public.users...');
  await db.insert(users).values({
    id: authUserId,
    email,
    name: 'test2 student',
  }).onConflictDoUpdate({
    target: users.email,
    set: { name: 'test2 student', id: authUserId }
  });

  console.log('2. Mapping School & Olympiad Relationships...');
  
  const educatorRes = await db.select({
    userId: users.id,
    schoolId: memberships.schoolId,
    portalId: memberships.portalId,
  })
  .from(users)
  .innerJoin(memberships, eq(users.id, memberships.userId))
  .innerJoin(schools, eq(memberships.schoolId, schools.id))
  .where(and(
    eq(users.email, 'jonteacher@gmail.com'),
    eq(memberships.role, 'educator'),
    eq(schools.name, 'jons school')
  ))
  .limit(1);

  if (educatorRes.length === 0) throw new Error('Educator jonteacher@gmail.com not found in memberships');
  const educator = educatorRes[0];

  const portalRes = await db.select({ portalId: portals.id })
    .from(portals)
    .innerJoin(users, eq(portals.ownerUserId, users.id))
    .where(and(
      eq(users.email, 'naomimareno05@gmail.com'),
      ilike(portals.name, 'national math olympiad%')
    ))
    .limit(1);

  if (portalRes.length === 0) throw new Error('Portal national math olympiad not found');
  const portalId = portalRes[0].portalId;

  console.log('Enrolling student in portal...');
  await db.insert(memberships).values({
    userId: authUserId,
    portalId,
    schoolId: educator.schoolId,
    role: 'student',
    status: 'accepted',
    invitedEmail: email,
    claimedAt: new Date(),
  }).onConflictDoUpdate({
    target: [memberships.portalId, memberships.invitedEmail],
    set: {
      userId: authUserId,
      schoolId: educator.schoolId,
      status: 'accepted',
      claimedAt: new Date(),
    }
  });

  // Also update user's schoolId to match just in case
  await db.update(users).set({ schoolId: educator.schoolId }).where(eq(users.id, authUserId));

  console.log('3. Reopening the closed round...');
  
  const roundRes = await db.select({ id: rounds.id })
    .from(rounds)
    .where(and(
      eq(rounds.portalId, portalId),
      ilike(rounds.name, '%general knowledge%')
    ))
    .limit(1);

  if (roundRes.length === 0) throw new Error('Round general knowledge section not found');
  const roundId = roundRes[0].id;

  const opensAt = new Date('2026-09-24T14:45:00Z'); // 16:45 SAST
  const closesAt = new Date('2026-09-24T17:45:00Z'); // 19:45 SAST

  await db.update(rounds)
    .set({
      opensAt,
      closesAt,
      resultsPublishedAt: null
    })
    .where(eq(rounds.id, roundId));

  console.log('Script completed successfully! Round dates updated and student enrolled.');
  process.exit(0);
}

main().catch(console.error);
