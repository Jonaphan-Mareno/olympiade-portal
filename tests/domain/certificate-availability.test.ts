import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRoundIdsWithCertificates } from '@/domain/certificates/availability';

// ─────────────────────────────────────────────────────────────────────────────
// Mock hub — capture the query chain and return canned rows.
// ─────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<{ roundId: string }>,
    selectCalls: 0,
  };
  const db = {
    selectDistinct: (_fields: unknown) => {
      state.selectCalls += 1;
      return {
        from: (_table: unknown) => ({
          where: (_cond: unknown) => Promise.resolve(state.rows),
        }),
      };
    },
  };
  return { state, db };
});

vi.mock('@/lib/db', () => ({ db: h.db }));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('getRoundIdsWithCertificates', () => {
  beforeEach(() => {
    h.state.rows = [];
    h.state.selectCalls = 0;
  });

  it('returns only the round IDs that have at least one template', async () => {
    h.state.rows = [{ roundId: 'r1' }, { roundId: 'r3' }];

    const result = await getRoundIdsWithCertificates(['r1', 'r2', 'r3']);

    expect(result).toBeInstanceOf(Set);
    expect([...result].sort()).toEqual(['r1', 'r3']);
    // r2 has no template configured → students must not be offered a download.
    expect(result.has('r2')).toBe(false);
  });

  it('returns an empty set when no rounds have templates', async () => {
    h.state.rows = [];

    const result = await getRoundIdsWithCertificates(['r1', 'r2']);

    expect(result.size).toBe(0);
  });

  it('short-circuits without querying when given no round IDs', async () => {
    const result = await getRoundIdsWithCertificates([]);

    expect(result.size).toBe(0);
    expect(h.state.selectCalls).toBe(0);
  });

  it('ignores blank/undefined IDs and de-duplicates the input', async () => {
    h.state.rows = [{ roundId: 'r1' }];

    const result = await getRoundIdsWithCertificates([
      'r1',
      'r1',
      '',
      undefined as unknown as string,
    ]);

    expect([...result]).toEqual(['r1']);
    expect(h.state.selectCalls).toBe(1);
  });
});
