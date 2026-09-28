/**
 * Round Advancement Engine
 *
 * When results are published for a round that has advancement thresholds set,
 * this module finds every student who qualifies and records their qualification
 * in the round_qualifications table for the NEXT round.
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
  roundQualifications,
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

  // FIX: Force marks to be treated as Numbers to prevent string concatenation
  const totalMarks = allQuestions.reduce((sum, q) => sum + Number(q.marks ?? 0), 0);

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

  if (hasScoreThreshold) {
    const minPct = parseFloat(currentRound.qualifyingThreshold as string);
    qualifiers = qualifiers.filter((e) => e.pct >= minPct);
  }

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

  // 7. Enroll qualifiers into the next round via round_qualifications
  const qualifierMembershipIds = new Set(qualifiers.map((q) => q.membershipId));

  let advancedCount = 0;
  let skippedAlreadyEnrolled = 0;

  for (const membershipId of qualifierMembershipIds) {
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membershipId));

    if (!membership) continue;

    // Check if the student is already qualified for the next round
    const existingQualification = await db
      .select({ id: roundQualifications.id })
      .from(roundQualifications)
      .where(
        and(
          eq(roundQualifications.roundId, nextRound.id),
          eq(roundQualifications.studentMembershipId, membershipId)
        )
      )
      .limit(1);

    if (existingQualification.length > 0) {
      skippedAlreadyEnrolled++;
      continue;
    }

    // Insert qualification for the next round
    await db.insert(roundQualifications).values({
      roundId: nextRound.id,
      studentMembershipId: membershipId,
    });
    advancedCount++;
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