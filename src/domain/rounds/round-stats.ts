// Participation and mark statistics for the organiser console. "Wrote"
// counts students who started an attempt (any submission, or an online exam
// sitting); "completed" counts students whose submission was submitted. All
// percentages derive from getRoundTotalMarks (question bank, or the stated
// total for paper rounds), so they agree with the rest of the app.
//
// The aggregation itself is a pure function so it can be unit tested without
// a database; getRoundStats only loads the raw rows and fans them out.

import { db } from '@/lib/db';
import {
  examSittings,
  memberships,
  questionPapers,
  results,
  roundQualifications,
  submissions,
} from '@/lib/db/schema';
import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { calculatePercentage, getRoundTotalMarks } from './score-percentage';

/** The round fields the statistics need; full round rows satisfy this. */
export type RoundStatInput = {
  id: string;
  portalId: string;
  qualifyingThreshold: string | null;
};

export type RoundStats = {
  /** Student memberships registered in the portal. */
  entrants: number;
  /** Distinct students who started an attempt (submission or sitting). */
  wrote: number;
  /** Distinct students whose submission is submitted. */
  completed: number;
  /** Submissions with a captured mark. */
  marked: number;
  averageScore: number | null;
  averagePercentage: number | null;
  /**
   * Share of marked results meeting the round's qualifying threshold.
   * null when the round has no threshold (or percentages cannot be computed).
   */
  passRate: number | null;
  /** Students enrolled into this round via advancement. */
  advanced: number;
};

export type ComputeRoundStatsInput = {
  qualifyingThreshold: string | null;
  totalMarks: number;
  /** Submissions of this round (any status). */
  submissionRows: { studentMembershipId: string | null; status: string | null }[];
  /** Students with an exam sitting for this round (online attempts). */
  sittingStudentIds: (string | null)[];
  /** Scores of the round's marked results. */
  markedScores: (string | number | null)[];
  advanced: number;
};

export function computeRoundStats(input: ComputeRoundStatsInput): RoundStats {
  const writers = new Set<string>();
  for (const row of input.submissionRows) {
    if (row.studentMembershipId) writers.add(row.studentMembershipId);
  }
  for (const id of input.sittingStudentIds) {
    if (id) writers.add(id);
  }

  const completers = new Set<string>();
  for (const row of input.submissionRows) {
    if (row.status === 'submitted' && row.studentMembershipId) {
      completers.add(row.studentMembershipId);
    }
  }

  const scores = input.markedScores
    .filter((s) => s !== null && s !== undefined && s !== '')
    .map((s) => Number(s))
    .filter((s) => Number.isFinite(s));

  // Keep the mean unrounded for the percentage (36.25/50 is 72.5%, not the
  // 72.6% the 1dp-rounded 36.3 would produce) and round only the display value.
  const meanScore =
    scores.length > 0
      ? scores.reduce((sum, s) => sum + s, 0) / scores.length
      : null;
  const averageScore =
    meanScore === null ? null : Math.round(meanScore * 10) / 10;
  const averagePercentage = calculatePercentage(meanScore, input.totalMarks);

  let passRate: number | null = null;
  const threshold =
    input.qualifyingThreshold === null || input.qualifyingThreshold === ''
      ? null
      : parseFloat(input.qualifyingThreshold);
  if (threshold !== null && !Number.isNaN(threshold) && scores.length > 0 && input.totalMarks > 0) {
    const passed = scores.filter((s) => (s / input.totalMarks) * 100 >= threshold).length;
    passRate = Math.round((passed / scores.length) * 1000) / 10;
  }

  return {
    entrants: 0,
    wrote: writers.size,
    completed: completers.size,
    marked: scores.length,
    averageScore,
    averagePercentage,
    passRate,
    advanced: input.advanced,
  };
}

/**
 * Participation and mark statistics per round, keyed by round id. Entrants
 * are filled in from the portal's student memberships (one grouped query for
 * all portals), matching the student totals shown on the olympiad page.
 */
export async function getRoundStats(
  roundInputs: RoundStatInput[]
): Promise<Map<string, RoundStats>> {
  const statsByRound = new Map<string, RoundStats>();
  if (roundInputs.length === 0) return statsByRound;

  const roundIds = roundInputs.map((r) => r.id);
  const portalIds = [...new Set(roundInputs.map((r) => r.portalId))];

  const [totalMarksByRound, submissionRows, sittingRows, markedRows, entrantRows, advancedRows] =
    await Promise.all([
      getRoundTotalMarks(roundIds),
      db
        .select({
          roundId: submissions.roundId,
          studentMembershipId: submissions.studentMembershipId,
          status: submissions.status,
        })
        .from(submissions)
        .where(inArray(submissions.roundId, roundIds)),
      db
        .select({
          roundId: questionPapers.roundId,
          studentMembershipId: examSittings.studentMembershipId,
        })
        .from(examSittings)
        .innerJoin(questionPapers, eq(examSittings.questionPaperId, questionPapers.id))
        .where(inArray(questionPapers.roundId, roundIds)),
      db
        .select({ roundId: submissions.roundId, score: results.score })
        .from(results)
        .innerJoin(submissions, eq(results.submissionId, submissions.id))
        .where(and(inArray(submissions.roundId, roundIds), isNotNull(results.score))),
      db
        .select({ portalId: memberships.portalId, total: count() })
        .from(memberships)
        .where(
          and(inArray(memberships.portalId, portalIds), eq(memberships.role, 'student'))
        )
        .groupBy(memberships.portalId),
      db
        .select({ roundId: roundQualifications.roundId, total: count() })
        .from(roundQualifications)
        .where(inArray(roundQualifications.roundId, roundIds))
        .groupBy(roundQualifications.roundId),
    ]);

  const entrantsByPortal = new Map<string, number>();
  for (const row of entrantRows) {
    entrantsByPortal.set(row.portalId, row.total);
  }
  const advancedByRound = new Map<string, number>();
  for (const row of advancedRows) {
    advancedByRound.set(row.roundId, row.total);
  }

  for (const round of roundInputs) {
    const stats = computeRoundStats({
      qualifyingThreshold: round.qualifyingThreshold,
      totalMarks: totalMarksByRound.get(round.id) ?? 0,
      submissionRows: submissionRows
        .filter((row) => row.roundId === round.id)
        .map((row) => ({
          studentMembershipId: row.studentMembershipId,
          status: row.status,
        })),
      sittingStudentIds: sittingRows
        .filter((row) => row.roundId === round.id)
        .map((row) => row.studentMembershipId),
      markedScores: markedRows
        .filter((row) => row.roundId === round.id)
        .map((row) => row.score),
      advanced: advancedByRound.get(round.id) ?? 0,
    });
    stats.entrants = entrantsByPortal.get(round.portalId) ?? 0;
    statsByRound.set(round.id, stats);
  }

  return statsByRound;
}
