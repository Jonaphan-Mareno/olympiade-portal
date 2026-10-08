import { describe, it, expect, vi, beforeEach } from 'vitest';
import { questions, rounds, questionPapers } from '@/lib/db/schema';

// getRoundTotalMarks runs three selects in parallel (questions, rounds,
// question_papers). The mock tells them apart by the table passed to `.from()`
// and serves canned rows for each. Table identities are injected after import
// because vi.hoisted runs first.
const h = vi.hoisted(() => {
  const state = {
    questionRows: [] as any[],
    roundRows: [] as any[],
    paperRows: [] as any[],
    tables: {} as Record<string, any>,
  };
  const rowsFor = (table: any): any[] => {
    if (table === state.tables.questions) return state.questionRows;
    if (table === state.tables.rounds) return state.roundRows;
    if (table === state.tables.questionPapers) return state.paperRows;
    return [];
  };
  const db = {
    select: (_fields?: any) => {
      let captured: any = null;
      const chain: any = {
        from: (t: any) => {
          captured = t;
          return chain;
        },
        where: () => chain,
        then: (res: any, rej: any) => Promise.resolve(rowsFor(captured)).then(res, rej),
      };
      return chain;
    },
  };
  return { state, db };
});

h.state.tables.questions = questions;
h.state.tables.rounds = rounds;
h.state.tables.questionPapers = questionPapers;

vi.mock('@/lib/db', () => ({ db: h.db }));

import { getRoundTotalMarks } from '@/domain/rounds/score-percentage';

const round = (over: Record<string, any> = {}) => ({
  id: 'round-1',
  targetTotalMarks: null,
  paperTotalMarks: null,
  ...over,
});

beforeEach(() => {
  h.state.questionRows = [];
  h.state.roundRows = [];
  h.state.paperRows = [];
});

describe('getRoundTotalMarks precedence', () => {
  it('(1) uses rounds.targetTotalMarks when > 0, above everything else', async () => {
    h.state.roundRows = [round({ targetTotalMarks: 100, paperTotalMarks: 40 })];
    h.state.questionRows = [
      { id: 'q1', roundId: 'round-1', marks: 5 },
      { id: 'q2', roundId: 'round-1', marks: 5 },
    ];
    h.state.paperRows = [{ roundId: 'round-1', selectedQuestionIds: ['q1'] }];

    const totals = await getRoundTotalMarks(['round-1']);
    expect(totals.get('round-1')).toBe(100);
  });

  it('(2) sums the selected questions when there is no target', async () => {
    h.state.roundRows = [round()];
    h.state.questionRows = [
      { id: 'q1', roundId: 'round-1', marks: 5 },
      { id: 'q2', roundId: 'round-1', marks: 7 },
      { id: 'q3', roundId: 'round-1', marks: 3 }, // not selected
    ];
    h.state.paperRows = [{ roundId: 'round-1', selectedQuestionIds: ['q2', 'q1'] }];

    const totals = await getRoundTotalMarks(['round-1']);
    expect(totals.get('round-1')).toBe(12); // 5 + 7, ignores q3
  });

  it('(3) sums the whole pool when there is no target or selection', async () => {
    h.state.roundRows = [round()];
    h.state.questionRows = [
      { id: 'q1', roundId: 'round-1', marks: 4 },
      { id: 'q2', roundId: 'round-1', marks: 6 },
      { id: 'q3', roundId: 'round-1', marks: null }, // nullable marks → 0
    ];
    h.state.paperRows = [];

    const totals = await getRoundTotalMarks(['round-1']);
    expect(totals.get('round-1')).toBe(10);
  });

  it('(3) legacy HYBRID: the pool sum wins over a stated paperTotalMarks', async () => {
    // A legacy hybrid round carries BOTH a non-empty pool AND paperTotalMarks.
    // The pre-variant denominator was the pool sum, so it must still win here;
    // otherwise published percentages (and advancement) get silently re-based.
    h.state.roundRows = [round({ paperTotalMarks: 80 })];
    h.state.questionRows = [
      { id: 'q1', roundId: 'round-1', marks: 10 },
      { id: 'q2', roundId: 'round-1', marks: 20 },
    ];
    h.state.paperRows = [{ roundId: 'round-1', selectedQuestionIds: null }];

    const totals = await getRoundTotalMarks(['round-1']);
    expect(totals.get('round-1')).toBe(30); // pool sum, NOT paperTotalMarks 80
  });

  it('(4) falls back to rounds.paperTotalMarks for a legacy paper with no pool', async () => {
    h.state.roundRows = [round({ paperTotalMarks: 80 })];
    h.state.questionRows = [];
    h.state.paperRows = [{ roundId: 'round-1', selectedQuestionIds: null }];

    const totals = await getRoundTotalMarks(['round-1']);
    expect(totals.get('round-1')).toBe(80);
  });

  it('(5) is 0 when there is nothing to total', async () => {
    h.state.roundRows = [round()];
    h.state.questionRows = [];
    h.state.paperRows = [];

    const totals = await getRoundTotalMarks(['round-1']);
    expect(totals.get('round-1')).toBe(0);
  });

  it('short-circuits on an empty id list without querying', async () => {
    const totals = await getRoundTotalMarks([]);
    expect(totals.size).toBe(0);
  });
});
