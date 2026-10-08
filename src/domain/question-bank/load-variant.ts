// The single loader that replaces the ad-hoc `where(eq(questions.roundId, …))`
// pool reads scattered across the app. Given a persisted id array (a sitting's
// dealt variant or a paper's hand-picked selection) it fetches exactly those
// questions and re-sorts them into the persisted order; given `null` it falls
// back to the whole round pool in insertion order (= today's legacy behavior).
//
// It NEVER throws: ids that no longer exist (e.g. an organiser pruned the pool
// after sittings started) are dropped with a warning rather than failing the
// read. Marks stay nullable — callers must not assume a number.

import { db } from '@/lib/db';
import { questions } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

/** A row carrying at least an `id`, so it can be ordered by an id list. */
export function orderByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) byId.set(row.id, row);

  const ordered: T[] = [];
  const used = new Set<T>();
  for (const id of ids) {
    const row = byId.get(id);
    if (row && !used.has(row)) {
      ordered.push(row);
      used.add(row);
    }
  }
  // Defensive: keep any rows not referenced by `ids` (lossless) at the end.
  // The loaders (loadSittingQuestions/loadPaperQuestions) rely on this: a
  // persisted id array is always a subset of the rows they were fetched with,
  // so the tail is normally empty — but if a caller ever passes a wider row set
  // the loader degrades to "whole pool" rather than silently dropping content.
  for (const row of rows) if (!used.has(row)) ordered.push(row);
  return ordered;
}

/**
 * STRICT, non-lossless ordering: return ONLY the rows referenced by `ids`, in
 * the given order. Unreferenced rows are intentionally dropped, and dangling
 * ids (present in `ids` but not in `rows`) are skipped rather than failing.
 *
 * This is the opposite of `orderByIds`' defensive lossless tail and exists for
 * callers where leaking unreferenced rows would be WRONG — notably the
 * organiser/educator `?variant=preview` branch, which must render exactly the
 * drawn variant and never append the undrawn pool questions still hidden from
 * students who are sitting the round. Do NOT swap this into the loaders; they
 * depend on the lossless null-fallback semantics of `orderByIds`.
 */
export function orderByIdsStrict<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) byId.set(row.id, row);

  const ordered: T[] = [];
  const used = new Set<T>();
  for (const id of ids) {
    const row = byId.get(id);
    if (row && !used.has(row)) {
      ordered.push(row);
      used.add(row);
    }
  }
  // No lossless tail: rows not referenced by `ids` are deliberately excluded.
  return ordered;
}

/** Coerce a jsonb id-array column into a `string[]` or `null`. */
function normalizeIds(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => String(v));
  return null;
}

async function loadByIdsOrPool(
  rawIds: unknown,
  roundId: string,
  label: string
): Promise<typeof questions.$inferSelect[]> {
  const ids = normalizeIds(rawIds);

  if (ids !== null) {
    // Authoritative subset: fetch exactly these ids, then restore their order.
    const rows = await db
      .select()
      .from(questions)
      .where(inArray(questions.id, ids));
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      console.warn(
        `[load-variant] ${label}: dropped ${missing.length} question id(s) that no longer exist (round ${roundId})`
      );
    }
    return orderByIds(rows, ids);
  }

  // Legacy: whole pool for the round, in insertion order.
  return db.select().from(questions).where(eq(questions.roundId, roundId));
}

/**
 * Load the questions for an exam sitting: the dealt variant when present, else
 * the whole round pool (legacy sittings). Rows are returned in the persisted
 * variant order; dangling ids are dropped with a warning.
 */
export async function loadSittingQuestions(
  sitting: { variantQuestionIds: string[] | null },
  roundId: string
) {
  return loadByIdsOrPool(sitting?.variantQuestionIds, roundId, 'sitting variant');
}

/**
 * Load the questions for a physical question paper: the organiser's ordered
 * selection when present, else the whole round pool (legacy papers).
 */
export async function loadPaperQuestions(
  paper: { selectedQuestionIds: string[] | null },
  roundId: string
) {
  return loadByIdsOrPool(paper?.selectedQuestionIds, roundId, 'paper selection');
}
