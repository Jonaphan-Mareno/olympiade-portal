import { db } from '@/lib/db';
import { questions, rounds, questionPapers } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';

/** Coerce a jsonb id-array column into a `string[]`, or `null` when unset. */
function normalizeIds(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => String(v));
  return null;
}

/**
 * Total marks obtainable per round — the single denominator for percentages,
 * thresholds and advancement. Precedence (first match wins):
 *   1. rounds.targetTotalMarks > 0            → the organiser's unified target;
 *   2. questionPapers.selectedQuestionIds set → sum of exactly those questions;
 *   3. whole question pool sums to > 0        → legacy online/hybrid rounds;
 *   4. rounds.paperTotalMarks > 0             → legacy paper round, no pool;
 *   5. nothing at all                         → 0.
 * Nullable marks are summed as 0.
 *
 * WHY the whole-pool sum (3) OUTRANKS the stated paper total (4): legacy
 * HYBRID rounds carry BOTH a non-empty question pool AND a paperTotalMarks.
 * The pre-variant code summed the pool first and only fell back to
 * paperTotalMarks when that sum was 0, so a hybrid round's denominator was
 * always the pool sum. Checking paperTotalMarks first would silently re-base
 * every existing hybrid round — changing its published percentages on load and,
 * because student pages, submit, standings AND advance-entrants.ts advancement
 * now all route through this single source, re-running advancement could flip
 * who qualified. Pool-sum-then-paper-total preserves the legacy behaviour while
 * keeping the single-source intent.
 */
export async function getRoundTotalMarks(
  roundIds: string[]
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const uniqueIds = [...new Set(roundIds)];
  if (uniqueIds.length === 0) return totals;

  const [questionRows, roundRows, paperRows] = await Promise.all([
    db
      .select({ id: questions.id, roundId: questions.roundId, marks: questions.marks })
      .from(questions)
      .where(inArray(questions.roundId, uniqueIds)),
    db
      .select({
        id: rounds.id,
        targetTotalMarks: rounds.targetTotalMarks,
        paperTotalMarks: rounds.paperTotalMarks,
      })
      .from(rounds)
      .where(inArray(rounds.id, uniqueIds)),
    db
      .select({
        roundId: questionPapers.roundId,
        selectedQuestionIds: questionPapers.selectedQuestionIds,
      })
      .from(questionPapers)
      .where(inArray(questionPapers.roundId, uniqueIds)),
  ]);

  // Group the pool by round and the paper selection by round.
  const poolByRound = new Map<string, Array<{ id: string; marks: number | null }>>();
  for (const q of questionRows) {
    const arr = poolByRound.get(q.roundId) ?? [];
    arr.push({ id: q.id, marks: q.marks });
    poolByRound.set(q.roundId, arr);
  }
  const selectionByRound = new Map<string, string[] | null>();
  for (const p of paperRows) {
    selectionByRound.set(p.roundId, normalizeIds(p.selectedQuestionIds));
  }

  for (const row of roundRows) {
    const id = row.id;

    // (1) Unified target total wins outright.
    if (row.targetTotalMarks !== null && row.targetTotalMarks > 0) {
      totals.set(id, row.targetTotalMarks);
      continue;
    }

    const pool = poolByRound.get(id) ?? [];

    // (2) A fixed physical selection: sum exactly the selected questions.
    const selection = selectionByRound.get(id);
    if (selection !== null && selection !== undefined) {
      const selected = new Set(selection);
      const sum = pool
        .filter((q) => selected.has(q.id))
        .reduce((s, q) => s + Number(q.marks ?? 0), 0);
      totals.set(id, sum);
      continue;
    }

    // (3) Whole pool sum when there is one. This is the legacy online/hybrid
    //     denominator and MUST outrank paperTotalMarks (see the note above),
    //     otherwise existing hybrid rounds get silently re-based.
    const poolSum = pool.reduce((s, q) => s + Number(q.marks ?? 0), 0);
    if (poolSum > 0) {
      totals.set(id, poolSum);
      continue;
    }

    // (4) Legacy stated paper total — a paper round with no question pool.
    if (row.paperTotalMarks !== null && row.paperTotalMarks > 0) {
      totals.set(id, row.paperTotalMarks);
      continue;
    }

    // (5) Nothing to total.
    totals.set(id, 0);
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
