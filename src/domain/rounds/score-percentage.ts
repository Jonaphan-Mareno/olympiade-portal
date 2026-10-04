import { db } from '@/lib/db';
import { questions, rounds } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';

/**
 * Total marks obtainable per round: the sum of every question's marks, or —
 * for paper rounds without a question bank — the organiser's stated paper
 * total. Rounds with neither map to 0.
 */
export async function getRoundTotalMarks(
  roundIds: string[]
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const uniqueIds = [...new Set(roundIds)];
  if (uniqueIds.length === 0) return totals;

  const [questionRows, roundRows] = await Promise.all([
    db
      .select({ roundId: questions.roundId, marks: questions.marks })
      .from(questions)
      .where(inArray(questions.roundId, uniqueIds)),
    db
      .select({ id: rounds.id, paperTotalMarks: rounds.paperTotalMarks })
      .from(rounds)
      .where(inArray(rounds.id, uniqueIds)),
  ]);

  for (const row of questionRows) {
    totals.set(row.roundId, (totals.get(row.roundId) ?? 0) + Number(row.marks ?? 0));
  }
  for (const row of roundRows) {
    if (!totals.get(row.id) && row.paperTotalMarks && row.paperTotalMarks > 0) {
      totals.set(row.id, row.paperTotalMarks);
    }
  }
  return totals;
}

/**
 * (marks obtained / marks obtainable) * 100, rounded to one decimal place.
 * Returns null when it cannot be computed (no score yet, or no known total).
 */
export function calculatePercentage(
  score: number | string | null | undefined,
  totalMarks: number | null | undefined
): number | null {
  if (score === null || score === undefined || score === '') return null;
  const obtained = Number(score);
  if (!Number.isFinite(obtained) || !totalMarks || totalMarks <= 0) return null;
  return Math.round((obtained / totalMarks) * 1000) / 10;
}

/**
 * Display string for a student's result: "85.7%" when the total is known,
 * otherwise the raw marks (e.g. a paper round with no stated total).
 */
export function formatScoreDisplay(
  score: number | string | null | undefined,
  totalMarks: number | null | undefined
): string {
  const pct = calculatePercentage(score, totalMarks);
  if (pct !== null) return `${pct}%`;
  if (score === null || score === undefined || score === '') return '-';
  return `${Number(score)} marks`;
}
