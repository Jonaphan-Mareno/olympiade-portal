/**
 * Round Advancement Engine
 *
 * When results are published for a round that has advancement thresholds set,
 * this module finds every student who qualifies and enrolls them (sets their
 * membership status to 'accepted') in the NEXT round of the same portal.
 *
 * Two advancement modes can be used independently or combined:
 *   qualifyingThreshold  – minimum score percentage (e.g. 60 means ≥ 60%)
 *   thresholdTopN        – only the top N scorers advance
 *
 * If both are set, a student must satisfy BOTH to advance.
 */

import { db } from '@/lib/db';
import {
  rounds,
  submissions,
  results as resultsTable,
  memberships,
  questions,
} from '@/lib/db/schema';
import { and, eq, gt, asc } from 'drizzle-orm';

export type AdvancementSummary = {
  advancedCount: number;
  skippedAlreadyEnrolled: number;
  nextRoundId: string | null;
  nextRoundName: string | null;
  noNextRound: boolean;
  noThresholdSet: boolean;
};

export async function advanceQualifyingEntrants(
  currentRoundId: string
): Promise<AdvancementSummary> {
  // 1. Load the current round
  const [currentRound] = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, currentRoundId));

  if (!currentRound) throw new Error('Round not found');

  const hasScoreThreshold = currentRound.qualifyingThreshold !== null;
  const hasTopN = currentRound.thresholdTopN !== null;

  if (!hasScoreThreshold && !hasTopN) {
    return {
      advancedCount: 0,
      skippedAlreadyEnrolled: 0,
      nextRoundId: null,
      nextRoundName: null,
      noNextRound: false,
      noThresholdSet: true,
    };
  }

  // 2. Find the next round (immediately higher orderIndex in same portal)
  const nextRounds = await db
    .select()
    .from(rounds)
    .where(
      and(
        eq(rounds.portalId, currentRound.portalId),
        gt(rounds.orderIndex, currentRound.orderIndex)
      )
    )
    .orderBy(asc(rounds.orderIndex))
    .limit(1);

  if (nextRounds.length === 0) {
    return {
      advancedCount: 0,
      skippedAlreadyEnrolled: 0,
      nextRoundId: null,
      nextRoundName: null,
      noNextRound: true,
      noThresholdSet: false,
    };
  }

  const nextRound = nextRounds[0];

  // 3. Compute the total marks available for this round (for % calculation)
  const allQuestions = await db
    .select({ marks: questions.marks })
    .from(questions)
    .where(eq(questions.roundId, currentRoundId));

  const totalMarks = allQuestions.reduce((sum, q) => sum + (q.marks ?? 0), 0);

  // 4. Load all submitted results for this round
  const submissionRows = await db
    .select({
      studentMembershipId: submissions.studentMembershipId,
      score: resultsTable.score,
      status: resultsTable.status,
    })
    .from(submissions)
    .innerJoin(resultsTable, eq(resultsTable.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.roundId, currentRoundId),
        eq(submissions.status, 'submitted')
      )
    );

  // 5. Convert scores to numbers and sort descending
  type ScoredEntry = { membershipId: string; score: number; pct: number };

  const scored: ScoredEntry[] = submissionRows
    .filter((r) => r.studentMembershipId !== null && r.score !== null)
    .map((r) => {
      const scoreNum = parseFloat(r.score as string);
      const pct = totalMarks > 0 ? (scoreNum / totalMarks) * 100 : 0;
      return { membershipId: r.studentMembershipId as string, score: scoreNum, pct };
    })
    .sort((a, b) => b.score - a.score);

  // 6. Apply filters
  let qualifiers = scored;

  // Score threshold filter (minimum percentage)
  if (hasScoreThreshold) {
    const minPct = parseFloat(currentRound.qualifyingThreshold as string);
    qualifiers = qualifiers.filter((e) => e.pct >= minPct);
  }

  // Top-N filter (slice after sorting)
  if (hasTopN) {
    const topN = currentRound.thresholdTopN as number;
    qualifiers = qualifiers.slice(0, topN);
  }

  if (qualifiers.length === 0) {
    return {
      advancedCount: 0,
      skippedAlreadyEnrolled: 0,
      nextRoundId: nextRound.id,
      nextRoundName: nextRound.name,
      noNextRound: false,
      noThresholdSet: false,
    };
  }

  // 7. Load existing memberships for the next round's portal so we can check
  //    who is already enrolled.
  //    Note: memberships are portal-level, not round-level, so we just need to
  //    ensure these students have an 'accepted' membership in the same portal.
  //    We upgrade 'invited' / 'pending' statuses to 'accepted' for qualifiers.
  const qualifierMembershipIds = new Set(qualifiers.map((q) => q.membershipId));

  let advancedCount = 0;
  let skippedAlreadyEnrolled = 0;

  for (const membershipId of qualifierMembershipIds) {
    // Load the student's current membership
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membershipId));

    if (!membership) continue;

    // Check if there's already an accepted student membership for the NEXT round's
    // portal (same userId, same portalId, student role)
    const existingNextRoundMembership = membership.userId
      ? await db
          .select({ id: memberships.id, status: memberships.status })
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, membership.userId),
              eq(memberships.portalId, nextRound.portalId),
              eq(memberships.role, 'student')
            )
          )
          .limit(1)
      : [];

    if (existingNextRoundMembership.length > 0) {
      const existing = existingNextRoundMembership[0];
      if (existing.status === 'accepted') {
        skippedAlreadyEnrolled++;
        continue;
      }
      // Upgrade status to accepted
      await db
        .update(memberships)
        .set({ status: 'accepted' })
        .where(eq(memberships.id, existing.id));
      advancedCount++;
    } else {
      // Create a brand-new accepted membership in the next round's portal
      await db.insert(memberships).values({
        userId: membership.userId,
        portalId: nextRound.portalId,
        schoolId: membership.schoolId,
        role: 'student',
        status: 'accepted',
        invitedEmail: membership.invitedEmail,
      });
      advancedCount++;
    }
  }

  return {
    advancedCount,
    skippedAlreadyEnrolled,
    nextRoundId: nextRound.id,
    nextRoundName: nextRound.name,
    noNextRound: false,
    noThresholdSet: false,
  };
}
