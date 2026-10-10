// Seeds a self-contained organiser account with rich preview data for
// browser-testing the organiser console statistics (dashboard stat cards,
// per-round metadata and the round statistics panel). Idempotent: it removes
// its own previous data before re-creating it. Never touches other data.
//
// Run with: node seed-organiser-preview.ts (Node 24 strips types natively)
// Login:    testorganiser2@gmail.com / 111111

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, sql } from 'drizzle-orm';
import {
  users,
  organiserApplications,
  portals,
  schools,
  memberships,
  rounds,
  questionPapers,
  questions,
  submissions,
  results,
  examSittings,
} from './src/lib/db/schema';

const ORGANISER_EMAIL = 'testorganiser2@gmail.com';
const ORGANISER_PASSWORD = '111111';
const PORTAL_NAME = 'QA Preview Olympics';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const connectionString = process.env.DATABASE_URL!;
const queryClient = postgres(connectionString, { prepare: false });
const db = drizzle(queryClient);

async function main() {
  console.log('1. Removing previous preview data (cascades own rows only)...');
  await db.execute(
    sql`DELETE FROM portals WHERE name = ${PORTAL_NAME}`
  );
  await db.execute(
    sql`DELETE FROM auth.users WHERE email = ${ORGANISER_EMAIL}`
  );

  console.log('2. Creating organiser in Supabase Auth...');
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: ORGANISER_EMAIL,
    password: ORGANISER_PASSWORD,
  });
  if (authError && authError.message !== 'User already registered') {
    console.error('Error creating user:', authError);
    process.exit(1);
  }

  await db.execute(
    sql`UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = ${ORGANISER_EMAIL}`
  );
  const authUserRes = await db.execute(
    sql`SELECT id FROM auth.users WHERE email = ${ORGANISER_EMAIL}`
  );
  if (authUserRes.length === 0) throw new Error('Auth user not found');
  const organiserUserId = authUserRes[0].id as string;

  console.log('3. Creating organiser profile + approved application...');
  await db.insert(users).values({
    id: organiserUserId,
    email: ORGANISER_EMAIL,
    name: 'Preview Organiser',
  });
  await db.insert(organiserApplications).values({
    userId: organiserUserId,
    pdfUrl: 'https://example.com/preview.pdf',
    status: 'approved',
  });

  console.log('4. Creating portal, school and memberships...');
  const [portal] = await db
    .insert(portals)
    .values({
      ownerUserId: organiserUserId,
      name: PORTAL_NAME,
      status: 'approved',
    })
    .returning({ id: portals.id });

  const [school] = await db
    .insert(schools)
    .values({
      portalId: portal.id,
      name: 'Preview High School',
      type: 'high_school',
    })
    .returning({ id: schools.id });

  await db.insert(memberships).values({
    portalId: portal.id,
    schoolId: school.id,
    role: 'educator',
    status: 'accepted',
    invitedEmail: 'preview.teacher@example.com',
  });

  const studentRows = await db
    .insert(memberships)
    .values(
      ['Amy', 'Ben', 'Cara', 'Dan'].map((name) => ({
        portalId: portal.id,
        schoolId: school.id,
        role: 'student' as const,
        status: 'accepted' as const,
        invitedEmail: `preview.${name.toLowerCase()}@example.com`,
      }))
    )
    .returning({ id: memberships.id });
  const [amy, ben, cara, dan] = studentRows.map((r) => r.id);

  console.log('5. Creating rounds...');
  const now = Date.now();
  const hoursFromNow = (h: number) => new Date(now + h * 3600 * 1000);

  // Round 1: online and open. Amy + Cara submitted (marked), Ben drafting,
  // Dan has an active sitting -> wrote 4, completed 2, marked 2.
  const [round1] = await db
    .insert(rounds)
    .values({
      portalId: portal.id,
      name: 'Online Preliminary',
      orderIndex: 1,
      deliveryMethod: 'online',
      opensAt: hoursFromNow(-24),
      closesAt: hoursFromNow(48),
      qualifyingThreshold: '50',
    })
    .returning({ id: rounds.id });

  const [paper1] = await db
    .insert(questionPapers)
    .values({ roundId: round1.id, durationMinutes: 60 })
    .returning({ id: questionPapers.id });

  await db.insert(questions).values([
    {
      roundId: round1.id,
      questionType: 'single_choice',
      prompt: 'What is 2 + 2?',
      options: ['3', '4', '5'],
      correctAnswer: '4',
      marks: 5,
    },
    {
      roundId: round1.id,
      questionType: 'true_false',
      prompt: 'Cape Town is the capital of South Africa.',
      options: ['True', 'False'],
      correctAnswer: 'False',
      marks: 5,
    },
  ]);

  const submissionValues = await db
    .insert(submissions)
    .values([
      {
        roundId: round1.id,
        studentMembershipId: amy,
        submissionType: 'online',
        status: 'submitted',
        startedAt: hoursFromNow(-2),
        submittedAt: hoursFromNow(-1),
      },
      {
        roundId: round1.id,
        studentMembershipId: ben,
        submissionType: 'online',
        status: 'draft',
        startedAt: hoursFromNow(-1),
      },
      {
        roundId: round1.id,
        studentMembershipId: cara,
        submissionType: 'online',
        status: 'submitted',
        startedAt: hoursFromNow(-2),
        submittedAt: hoursFromNow(-1),
      },
    ])
    .returning({ id: submissions.id });

  // Round totals: 10 marks. Amy 7 (70%), Cara 4 (40%).
  await db.insert(results).values([
    {
      submissionId: submissionValues[0].id,
      score: '7',
      status: 'auto_marked',
    },
    {
      submissionId: submissionValues[2].id,
      score: '4',
      status: 'auto_marked',
    },
  ]);

  await db.insert(examSittings).values({
    studentMembershipId: dan,
    questionPaperId: paper1.id,
    startedAt: hoursFromNow(-1),
    status: 'active',
  });

  // Round 2: paper round, not open yet. No activity.
  await db.insert(rounds).values({
    portalId: portal.id,
    name: 'Paper Semifinal',
    orderIndex: 2,
    deliveryMethod: 'paper',
    opensAt: hoursFromNow(24 * 10),
    closesAt: hoursFromNow(24 * 12),
    qualifyingThreshold: '60',
    paperTotalMarks: 50,
  });

  // Round 3: closed paper round, every entrant marked by the educator.
  const [round3] = await db
    .insert(rounds)
    .values({
      portalId: portal.id,
      name: 'Paper Practice (Closed)',
      orderIndex: 3,
      deliveryMethod: 'paper',
      opensAt: hoursFromNow(-72),
      closesAt: hoursFromNow(-24),
      qualifyingThreshold: '40',
      paperTotalMarks: 50,
      markingClosesAt: hoursFromNow(-12),
    })
    .returning({ id: rounds.id });

  const [educatorMembership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.portalId, portal.id), eq(memberships.role, 'educator'))
    );

  const closedSubmissions = await db
    .insert(submissions)
    .values(
      [amy, ben, cara, dan].map((studentMembershipId) => ({
        roundId: round3.id,
        studentMembershipId,
        submittedByMembershipId: educatorMembership.id,
        submissionType: 'offline' as const,
        status: 'submitted' as const,
        submittedAt: hoursFromNow(-30),
      }))
    )
    .returning({ id: submissions.id });

  await db.insert(results).values(
    closedSubmissions.map((submission, idx) => ({
      submissionId: submission.id,
      gradedByMembershipId: educatorMembership.id,
      score: ['30', '45', '50', '20'][idx],
      status: 'auto_marked' as const,
    }))
  );

  console.log('\nSeed complete! Log in with:');
  console.log(`  email:    ${ORGANISER_EMAIL}`);
  console.log(`  password: ${ORGANISER_PASSWORD}`);
  console.log(`  portal:   ${PORTAL_NAME} (${portal.id})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
