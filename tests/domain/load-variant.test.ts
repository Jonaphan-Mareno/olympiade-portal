import { describe, it, expect, vi, beforeEach } from 'vitest';

// Covers the load-variant ordering helpers and the loaders' legacy null
// fallback.
//
//   • `orderByIds` is intentionally LOSSLESS — after emitting the referenced
//     rows it appends every unreferenced row. The loaders depend on this.
//   • `orderByIdsStrict` is the NON-lossless variant used by the organiser
//     `?variant=preview` branch: it returns ONLY the referenced rows, so the
//     undrawn pool questions are never leaked.
//   • loadSittingQuestions / loadPaperQuestions must still return the WHOLE
//     pool (insertion order) when the persisted id array is null.

const h = vi.hoisted(() => {
  const state = {
    // Queued row arrays, one per `.where(...)` the loaders perform.
    results: [] as any[][],
  };
  // The loaders await `.where(...)` directly; expose `.limit` too so the same
  // thenable satisfies callers that chain it.
  const asResult = (rows: any[]) => {
    const p = Promise.resolve(rows) as Promise<any[]> & { limit?: () => any };
    p.limit = () => p;
    return p;
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => asResult(state.results.shift() ?? []),
      }),
    }),
  };
  return { state, db };
});

vi.mock('@/lib/db', () => ({ db: h.db }));

import {
  orderByIds,
  orderByIdsStrict,
  loadSittingQuestions,
  loadPaperQuestions,
} from '@/domain/question-bank/load-variant';

const row = (id: string) => ({ id });
const POOL = [row('q-1'), row('q-2'), row('q-3'), row('q-4')];

beforeEach(() => {
  vi.clearAllMocks();
  h.state.results = [];
});

describe('orderByIdsStrict (non-lossless, used by the preview branch)', () => {
  it('returns ONLY the referenced rows, in the given id order', () => {
    const out = orderByIdsStrict(POOL, ['q-3', 'q-1']);
    expect(out.map((r) => r.id)).toEqual(['q-3', 'q-1']);
  });

  it('does NOT append unreferenced pool rows (the leak this fixes)', () => {
    const out = orderByIdsStrict(POOL, ['q-3', 'q-1']);
    // q-2 and q-4 were not drawn, so they must be absent.
    expect(out.map((r) => r.id)).not.toContain('q-2');
    expect(out.map((r) => r.id)).not.toContain('q-4');
    expect(out).toHaveLength(2);
  });

  it('drops dangling ids that are not present in rows', () => {
    const out = orderByIdsStrict(POOL, ['q-1', 'ghost', 'q-2']);
    expect(out.map((r) => r.id)).toEqual(['q-1', 'q-2']);
  });

  it('never repeats a row when an id is listed twice', () => {
    const out = orderByIdsStrict(POOL, ['q-1', 'q-1', 'q-2']);
    expect(out.map((r) => r.id)).toEqual(['q-1', 'q-2']);
  });
});

describe('orderByIds (lossless — legacy loader behavior must be preserved)', () => {
  it('appends every unreferenced row after the referenced ones', () => {
    const out = orderByIds(POOL, ['q-3', 'q-1']);
    // Referenced rows first (in id order), then the rest in insertion order.
    expect(out.map((r) => r.id)).toEqual(['q-3', 'q-1', 'q-2', 'q-4']);
  });

  it('is a strict superset of orderByIdsStrict for the same inputs', () => {
    const ids = ['q-3', 'q-1'];
    const strict = orderByIdsStrict(POOL, ids).map((r) => r.id);
    const lossless = orderByIds(POOL, ids).map((r) => r.id);
    expect(lossless.slice(0, strict.length)).toEqual(strict);
    expect(lossless.length).toBe(POOL.length);
  });
});

describe('loadSittingQuestions / loadPaperQuestions legacy null fallback', () => {
  it('loadSittingQuestions returns the WHOLE pool in insertion order when variantQuestionIds is null', async () => {
    h.state.results = [POOL];
    const out = await loadSittingQuestions({ variantQuestionIds: null }, 'round-1');
    expect(out.map((r) => r.id)).toEqual(['q-1', 'q-2', 'q-3', 'q-4']);
  });

  it('loadPaperQuestions returns the WHOLE pool in insertion order when selectedQuestionIds is null', async () => {
    h.state.results = [POOL];
    const out = await loadPaperQuestions({ selectedQuestionIds: null }, 'round-1');
    expect(out.map((r) => r.id)).toEqual(['q-1', 'q-2', 'q-3', 'q-4']);
  });

  it('loadSittingQuestions scopes to the variant (in order) when an id array is present', async () => {
    // inArray() fetch returns exactly the dealt rows; orderByIds restores order.
    h.state.results = [[row('q-3'), row('q-1')]];
    const out = await loadSittingQuestions(
      { variantQuestionIds: ['q-1', 'q-3'] },
      'round-1'
    );
    expect(out.map((r) => r.id)).toEqual(['q-1', 'q-3']);
  });
});
