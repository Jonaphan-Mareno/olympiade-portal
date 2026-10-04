import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sweep } from '@/domain/rounds/round-scheduler';

// sweep() queries rounds+portals once, loads each portal's active automation
// rules, then hands each round to runDueRules (mocked here) — rule timing is
// covered by tests/domain/automation-rules.test.ts and the emails themselves
// by tests/domain/automation-engine.test.ts.
const state = vi.hoisted(() => ({
  rounds: [] as any[],
  rulesByPortal: new Map<string, any[]>(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(state.rounds),
        }),
      }),
    }),
  },
}));

vi.mock('@/domain/notifications/automation-rules', () => ({
  loadActiveRules: vi.fn(async () => state.rulesByPortal),
  runDueRules: vi.fn(async (rules: any[]) => ({
    triggered: rules.map((r) => r.name),
    summary: { sent: rules.length, skipped: 0, failed: 0 },
  })),
}));

import {
  loadActiveRules,
  runDueRules,
} from '@/domain/notifications/automation-rules';

const NOW = new Date('2026-09-14T07:00:00Z');

function makeRound(overrides: Partial<{ id: string; portalId: string }> = {}) {
  return {
    id: 'round-1',
    portalId: 'portal-1',
    portalName: 'Maths Olympiad',
    name: 'Round 1',
    orderIndex: 1,
    deliveryMethod: 'paper',
    opensAt: new Date('2026-09-01T09:00:00Z'),
    closesAt: new Date('2026-09-10T17:00:00Z'),
    qualifyingThreshold: '30',
    resultsPublishedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rounds = [];
  state.rulesByPortal = new Map();
});

describe('sweep', () => {
  it("runs each round against its own portal's rules", async () => {
    state.rounds = [
      makeRound({ id: 'round-1', portalId: 'portal-1' }),
      makeRound({ id: 'round-2', portalId: 'portal-2' }),
    ];
    state.rulesByPortal = new Map([
      ['portal-1', [{ name: 'Closing reminder' }]],
      ['portal-2', [{ name: 'Overdue chase' }, { name: 'Results out' }]],
    ]);

    const result = await sweep(NOW);

    expect(loadActiveRules).toHaveBeenCalledWith(['portal-1', 'portal-2']);
    expect(result.portalCount).toBe(2);
    expect(result.outcomes[0].triggered).toEqual(['Closing reminder']);
    expect(result.outcomes[1].triggered).toEqual(['Overdue chase', 'Results out']);
    expect(result.outcomes[1].summary.sent).toBe(2);
    expect(result.outcomes[0].state).toBe('closed');
  });

  it('sends nothing for portals with no rules configured', async () => {
    state.rounds = [makeRound()];

    const result = await sweep(NOW);

    expect(runDueRules).toHaveBeenCalledWith([], expect.anything(), NOW);
    expect(result.outcomes[0].triggered).toEqual([]);
    expect(result.outcomes[0].summary).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it('isolates failures of a single round from the rest of the sweep', async () => {
    (runDueRules as any).mockRejectedValueOnce(new Error('engine blew up'));
    state.rounds = [makeRound({ id: 'round-1' }), makeRound({ id: 'round-2' })];
    state.rulesByPortal = new Map([['portal-1', [{ name: 'Rule' }]]]);

    const result = await sweep(NOW);

    expect(result.outcomes[0].summary.failed).toBe(1);
    expect(result.outcomes[1].summary.sent).toBe(1);
  });

  it('returns an empty result when there are no rounds', async () => {
    const result = await sweep(NOW);

    expect(result).toEqual({
      ranAt: NOW.toISOString(),
      portalCount: 0,
      roundCount: 0,
      outcomes: [],
    });
  });
});
