import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  memberships,
  portals,
  rounds,
  submissions,
  results as resultsTable,
  questionPapers,
  examSittings,
  roundQualifications, 
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import RoundTabs from '../RoundTabs';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import { getRoundTotalMarks } from '@/domain/rounds/score-percentage';

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

  // Fetch the rounds this student has explicitly qualified for
  const qualifications = await db
    .select()
    .from(roundQualifications)
    .where(eq(roundQualifications.studentMembershipId, membership.id));

  // Create a quick lookup Set of round IDs they are allowed to access
  const qualifiedRoundIds = new Set(qualifications.map((q) => q.roundId));

  const portalRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.portalId, portalId));

  // Sort by orderIndex
  portalRounds.sort((a, b) => a.orderIndex - b.orderIndex);

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

  // Single denominator source of truth (target total → selection → paper total →
  // pool sum), so the displayed max matches advancement instead of a raw pool sum.
  const totalMarksByRound = await getRoundTotalMarks(roundIds);

  const onlineRounds = portalRounds.filter(
    (r) => r.deliveryMethod === 'online' || r.deliveryMethod === 'hybrid'
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
      id: round.id,
      name: round.name,
      opensAt: round.opensAt,
      closesAt: round.closesAt,
      qualifyingThreshold: round.qualifyingThreshold,
      deliveryMethod: round.deliveryMethod as 'online' | 'paper' | 'hybrid', 
      isQualified: round.orderIndex === 1 || qualifiedRoundIds.has(round.id),
      state: deriveRoundState(round),
      myResult: round.resultsPublishedAt
        ? {
            submitted: mine?.submitted ?? false,
            score: mine?.score ? Number(mine.score) : null,
            maxScore: totalMarksByRound.get(round.id) ?? null,
            feedback: mine?.feedback ?? null,
          }
        : null,
      durationMinutes: paper?.durationMinutes ?? 60,
      sittingId: sitting?.id ?? null,
      sittingStatus: sitting?.status as 'active' | 'submitted' | 'abandoned' | null,
    };
  });

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <h2 className="font-serif text-3xl md:text-4xl text-blue-950 font-bold mb-8 m-0">
          My Rounds
        </h2>
        <RoundTabs rounds={roundView} />
      </div>
    </div>
  );
}