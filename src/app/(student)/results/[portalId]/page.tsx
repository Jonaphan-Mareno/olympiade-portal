import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  memberships,
  portals,
  schools,
  rounds,
  submissions,
  results as resultsTable,
  questionPapers,
  examSittings,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import RoundTabs from './RoundTabs';
import Link from 'next/link';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';

export const dynamic = 'force-dynamic';

export default async function PortalRoundsPage({
  params,
}: {
  params: Promise<{ portalId: string }>;
}) {
  const { portalId } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if user is a student member of this portal
  const studentMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.role, 'student'),
        eq(memberships.portalId, portalId)
      )
    );

  if (studentMemberships.length === 0) {
    redirect('/results');
  }

  const membership = studentMemberships[0];

  const [portalResult] = await db
    .select()
    .from(portals)
    .where(eq(portals.id, portalId));

  if (!portalResult) {
    redirect('/results');
  }

  let schoolName = null;

  if (membership.schoolId) {
    const [schoolResult] = await db
      .select()
      .from(schools)
      .where(eq(schools.id, membership.schoolId));

    if (schoolResult) {
      schoolName = schoolResult.name;
    }
  }

  const portalRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.portalId, portalId));

  // Sort by orderIndex
  portalRounds.sort((a, b) => a.orderIndex - b.orderIndex);

  // ---------------------------------------------------------------------------
  // Existing results functionality
  // ---------------------------------------------------------------------------

  // The entrant's own submission + result per round, shown once results are
  // released (the organiser triggers the release, which also emails the entrant)
  const roundIds = portalRounds.map((r) => r.id);

  const mySubmissions =
    roundIds.length > 0
      ? await db
          .select({
            roundId: submissions.roundId,
            status: submissions.status,
            score: resultsTable.score,
            feedback: resultsTable.feedback,
          })
          .from(submissions)
          .leftJoin(
            resultsTable,
            eq(resultsTable.submissionId, submissions.id)
          )
          .where(
            and(
              inArray(submissions.roundId, roundIds),
              eq(submissions.studentMembershipId, membership.id)
            )
          )
      : [];

  const myResultByRound = new Map(
    mySubmissions.map((s) => [
      s.roundId,
      {
        submitted: s.status === 'submitted',
        score: s.score,
        feedback: s.feedback,
      },
    ])
  );

  // ---------------------------------------------------------------------------
  // Online test functionality
  // ---------------------------------------------------------------------------

  const onlineRounds = portalRounds.filter(
    (r) => r.deliveryMethod === 'online'
  );

  const paperRows =
  onlineRounds.length > 0
    ? await db
        .select()
        .from(questionPapers)
        .where(
          inArray(
            questionPapers.roundId,
            onlineRounds.map((r) => r.id)
          )
        )
    : [];

  const paperIds = paperRows.map((p) => p.id);

  const sittingRows =
    paperIds.length > 0
      ? await db
          .select()
          .from(examSittings)
          .where(
            and(
              eq(examSittings.studentMembershipId, membership.id),
              inArray(examSittings.questionPaperId, paperIds)
            )
          )
      : [];

  // ---------------------------------------------------------------------------
  // Combine existing results data with online test data
  // ---------------------------------------------------------------------------

  const roundView = portalRounds.map((round) => {
  const mine = myResultByRound.get(round.id);

  const paper = paperRows.find(
    (p) => p.roundId === round.id
  );

  const sitting = paper
    ? sittingRows.find(
        (s) =>
          s.questionPaperId === paper.id &&
          s.status !== 'abandoned'
      )
    : undefined;

  return {
    // Keep ALL properties from the original Round object.
    // This includes deliveryMethod and anything else RoundTabs expects.
    ...round,

    // Existing results functionality
    state: deriveRoundState(round),

    myResult: round.resultsPublishedAt
      ? {
          submitted: mine?.submitted ?? false,
          score: mine?.score ?? null,
          feedback: mine?.feedback ?? null,
        }
      : null,

    // Online test functionality
    durationMinutes: paper?.durationMinutes ?? 60,
    sittingId: sitting?.id ?? null,
    sittingStatus: sitting?.status ?? null,
  };
});

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#F8FAFC',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ marginBottom: '2rem' }}>
          <Link
            href="/results"
            style={{
              color: '#0066CC',
              textDecoration: 'none',
              fontWeight: '500',
            }}
          >
            &larr; Back to Dashboard
          </Link>
        </div>

        <h1
          style={{
            fontSize: '2.25rem',
            fontWeight: 'bold',
            color: '#0F172A',
            marginBottom: '0.5rem',
          }}
        >
          {portalResult.name}
        </h1>

        {schoolName && (
          <p
            style={{
              fontSize: '1.1rem',
              color: '#64748B',
              marginBottom: '0.5rem',
            }}
          >
            {schoolName}
          </p>
        )}

        <div
          style={{
            display: 'inline-block',
            fontSize: '0.75rem',
            fontWeight: '600',
            padding: '0.25rem 0.75rem',
            borderRadius: '9999px',
            background:
              membership.status === 'accepted' ? '#DCFCE7' : '#F1F5F9',
            color:
              membership.status === 'accepted' ? '#166534' : '#475569',
            marginTop: '0.5rem',
          }}
        >
          Status: {membership.status}
        </div>

        <RoundTabs rounds={roundView} />
      </div>
    </div>
  );
}
