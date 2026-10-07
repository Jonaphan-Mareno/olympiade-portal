// Publish-time readiness guards. PURE and DB-free so the SAME functions run
// server-side (authoritative, in the round authoring actions) and client-side
// (advisory, in the PublishReadinessPanel). A draft may omit marks/difficulty;
// publishing a round may not.
//
// Online: the whole pool must be fully specified and the organiser's target
// total must be *reachable* by the balanced draw. Reachability is proved with a
// SEED-INDEPENDENT exact subset-sum oracle (`canReachExactly`), NOT a single
// seeded `drawVariant` probe: `drawVariant` is order/seed-dependent, so a lucky
// fixed seed could go GREEN while real crypto-seeded draws fall short (Ryan #2).
// `drawVariant` now guarantees exactness whenever `canReachExactly` is true, so
// the guard and every real draw agree.
// Physical: only the hand-picked selection must carry marks; difficulty is not
// used and unselected pool questions may stay draft.

import { canReachExactly, type PoolQuestion } from './variant-generator';

export type ReadinessIssue = {
  questionId?: string;
  field: 'marks' | 'difficulty' | 'targetTotalMarks' | 'selection' | 'pool';
  message: string;
};

export type ReadinessResult = {
  ok: boolean;
  issues: ReadinessIssue[];
  summary: string[];
};

/**
 * Fixed seed for the DETERMINISTIC PREVIEW draw in the paper route (a stable,
 * reproducible variant for organisers). It is intentionally NOT used by the
 * publish guard any more — reachability is proved seed-independently by
 * `canReachExactly`, so a single lucky seed can never mask an unfair pool.
 */
export const FIXED_SEED = 0x5eedc0de;

/** Upper bound on the subset-sum sweep used to name nearest achievable totals. */
const NEAREST_TOTALS_CAP = 200_000;

function isPositiveInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/** Marks valid for the online draw: a finite integer ≥ 1. */
function hasValidMarks(marks: unknown): boolean {
  return typeof marks === 'number' && Number.isFinite(marks) && Number.isInteger(marks) && marks >= 1;
}

/** Difficulty valid for the online draw: an integer in 1..5. */
function hasValidDifficulty(difficulty: unknown): boolean {
  return (
    typeof difficulty === 'number' &&
    Number.isInteger(difficulty) &&
    difficulty >= 1 &&
    difficulty <= 5
  );
}

/**
 * Nearest achievable pool totals to `target`, computed by an exact subset-sum
 * sweep over the (normalized integer) pool marks — the SAME normalization and
 * subset-sum semantics as `canReachExactly`, so the two can never disagree.
 * Returns the closest reachable totals STRICTLY below and above the target (the
 * target itself is never reported here) purely as organiser guidance; whether
 * the target is reachable is decided solely by `canReachExactly`. Bounded by
 * NEAREST_TOTALS_CAP; returns [] when the sweep would be too large.
 */
export function nearestAchievableTotals(pool: PoolQuestion[], target: number): number[] {
  const marks = pool
    .map((q) => (typeof q.marks === 'number' && Number.isFinite(q.marks) ? Math.max(1, Math.round(q.marks)) : 1));
  const maxSum = marks.reduce((s, m) => s + m, 0);
  if (!Number.isInteger(target) || target < 0 || maxSum > NEAREST_TOTALS_CAP) return [];

  const reach = new Uint8Array(maxSum + 1);
  reach[0] = 1;
  for (const m of marks) {
    for (let s = maxSum; s >= m; s--) {
      if (reach[s - m] === 1) reach[s] = 1;
    }
  }

  const below: number[] = [];
  const above: number[] = [];
  for (let s = 0; s <= maxSum; s++) {
    if (reach[s] !== 1 || s === target) continue;
    if (s < target) below.push(s);
    else above.push(s);
  }
  const result: number[] = [];
  if (below.length) result.push(below[below.length - 1]); // largest reachable below
  if (above.length) result.push(above[0]); // smallest reachable above
  return result;
}

/**
 * Online publish readiness: every pool question must carry an integer mark ≥ 1
 * and a difficulty 1..5, the target must be a positive integer, and the target
 * must be exactly reachable (`canReachExactly`) by the balanced draw. The
 * reachability proof is seed-independent, so it holds for every real draw.
 */
export function checkOnlinePublishReadiness(
  pool: PoolQuestion[],
  targetTotal: number
): ReadinessResult {
  const issues: ReadinessIssue[] = [];
  const summary: string[] = [];

  if (!Array.isArray(pool) || pool.length === 0) {
    issues.push({ field: 'pool', message: 'Add at least one question to the pool before publishing.' });
  }

  for (const q of pool ?? []) {
    if (!hasValidMarks(q.marks)) {
      issues.push({
        questionId: q.id,
        field: 'marks',
        message:
          q.marks === null || q.marks === undefined
            ? 'Question is missing its marks.'
            : 'Question marks must be a whole number of 1 or more.',
      });
    }
    if (!hasValidDifficulty(q.difficulty)) {
      issues.push({
        questionId: q.id,
        field: 'difficulty',
        message: 'Question needs a difficulty from 1 to 5.',
      });
    }
  }

  if (!isPositiveInteger(targetTotal)) {
    issues.push({
      field: 'targetTotalMarks',
      message: 'Set a target total marks that is a whole number greater than zero.',
    });
  }

  // Reachability is only meaningful once the pool and target are well-formed.
  // Prove it SEED-INDEPENDENTLY with the exact subset-sum oracle so the guard
  // agrees with every real (crypto-seeded) draw — a green guard now genuinely
  // means each student can hit the target exactly.
  const marksOk = pool?.length > 0 && pool.every((q) => hasValidMarks(q.marks));
  if (marksOk && isPositiveInteger(targetTotal)) {
    const reachable = canReachExactly(
      pool.map((q) => q.marks),
      targetTotal
    );
    if (!reachable) {
      const nearest = nearestAchievableTotals(pool, targetTotal);
      issues.push({
        field: 'targetTotalMarks',
        message: `No balanced draw can hit exactly ${targetTotal} marks from this pool.`,
      });
      summary.push(
        nearest.length > 0
          ? `Target ${targetTotal} marks is not reachable from this pool; nearest achievable totals are ${nearest.join(' and ')} marks.`
          : `Target ${targetTotal} marks is not reachable from this pool; adjust the target or the question marks.`
      );
    } else {
      summary.push(`Balanced draw reaches the ${targetTotal}-mark target exactly.`);
    }
  }

  return { ok: issues.length === 0, issues, summary };
}

/**
 * Physical publish readiness: the organiser's ordered selection must be
 * non-empty, a subset of the pool, and every SELECTED question must carry
 * marks. Difficulty is not used for physical papers, and unselected pool
 * questions may stay draft (never flagged).
 */
export function checkPhysicalPublishReadiness(
  pool: PoolQuestion[],
  selectedIds: string[] | null | undefined
): ReadinessResult {
  const issues: ReadinessIssue[] = [];
  const summary: string[] = [];

  if (!Array.isArray(pool) || pool.length === 0) {
    issues.push({ field: 'pool', message: 'Add at least one question to the pool before publishing.' });
  }

  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  if (ids.length === 0) {
    issues.push({ field: 'selection', message: 'Select the questions that make up the paper.' });
    return { ok: false, issues, summary };
  }

  const poolById = new Map<string, PoolQuestion>();
  for (const q of pool ?? []) poolById.set(q.id, q);

  for (const id of ids) {
    const q = poolById.get(id);
    if (!q) {
      issues.push({
        questionId: id,
        field: 'selection',
        message: 'A selected question is no longer in the pool. Re-select it.',
      });
      continue;
    }
    if (!hasValidMarks(q.marks)) {
      issues.push({
        questionId: id,
        field: 'marks',
        message: 'Selected question is missing its marks.',
      });
    }
  }

  const selectedMarks = ids.reduce((s, id) => {
    const q = poolById.get(id);
    return s + (q && typeof q.marks === 'number' && Number.isFinite(q.marks) ? q.marks : 0);
  }, 0);
  if (issues.length === 0) {
    summary.push(`Selected ${ids.length} question(s) totalling ${selectedMarks} marks.`);
  }

  return { ok: issues.length === 0, issues, summary };
}
