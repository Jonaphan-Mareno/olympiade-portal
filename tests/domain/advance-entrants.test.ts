import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rounds,
  questions,
  questionPapers,
  submissions,
  memberships,
  roundQualifications,
} from '@/lib/db/schema';

// advanceQualifyingEntrants reads several tables and calls getRoundTotalMarks
// (which itself selects questions/rounds/question_papers). `rounds` is selected
// three times in a fixed order (current round, next round, then the totals
// lookup), so it is served from a FIFO queue; every other table returns a fixed
// row set. Inserts into round_qualifications are recorded for assertions.
const h = vi.hoisted(() => {
  const state = {
    roundsQueue: [] as any[][],
    questionRows: [] as any[],
    paperRows: [] as any[],
    submissionRows: [] as any[],
    membershipRows: [] as any[],
    qualificationRows: [] as any[],
    inserts: [] as Array<{ table: any; values: any }>,
    tables: {} as Record<string, any>,
  };

  const rowsFor = (table: any): any[] => {
    if (table === state.tables.rounds) return state.roundsQueue.shift() ?? [];
    if (table === state.tables.questions) return state.questionRows;
    if (table === state.tables.questionPapers) return state.paperRows;
    if (table === state.tables.submissions) return state.submissionRows;
    if (table === state.tables.memberships) return state.membershipRows;
    if (table === state.tables.roundQualifications) return state.qualificationRows;
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
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (res: any, rej: any) => Promise.resolve(rowsFor(captured)).then(res, rej),
      };
      return chain;
    },
    insert: (table: any) => ({
      values: (values: any) => {
        state.inserts.push({ table, values });
        return Promise.resolve();
      },
    }),
  };

  return { state, db };
});

h.state.tables.rounds = rounds;
h.state.tables.questions = questions;
h.state.tables.questionPapers = questionPapers;
h.state.tables.submissions = submissions;
h.state.tables.memberships = memberships;
h.state.tables.roundQualifications = roundQualifications;

vi.mock('@/lib/db', () => ({ db: h.db }));

import { advanceQualifyingEntrants } from '@/domain/rounds/advance-entrants';

const currentRound = {
  id: 'round-1',
  portalId: 'p1',
  orderIndex: 1,
  qualifyingThreshold: '60',
  thresholdTopN: null,
};
const nextRound = { id: 'round-2', name: 'Round 2', portalId: 'p1', orderIndex: 2 };
// getRoundTotalMarks resolves via precedence (1): the fixed target total.
const totalsRoundRow = { id: 'round-1', targetTotalMarks: 100, paperTotalMarks: null };

beforeEach(() => {
  h.state.roundsQueue = [[currentRound], [nextRound], [totalsRoundRow]];
  h.state.questionRows = [];
  h.state.paperRows = [];
  h.state.membershipRows = [{ id: 'membership-any' }];
  h.state.qualificationRows = [];
  h.state.inserts = [];
  // Two entrants dealt DIFFERENT variants but scoring the same against the
  // shared 100-mark target → identical 80% → both must advance.
  h.state.submissionRows = [
    {
      studentMembershipId: 'm1',
      score: '80',
      status: 'submitted',
      variantQuestionIds: ['q1', 'q2', 'q3'],
    },
    {
      studentMembershipId: 'm2',
      score: '80',
      status: 'submitted',
      variantQuestionIds: ['q4', 'q5', 'q6', 'q7'],
    },
  ];
});

describe('advanceQualifyingEntrants with per-entrant variants', () => {
  it('advances entrants on different variants identically at equal percentage', async () => {
    const summary = await advanceQualifyingEntrants('round-1');

    expect(summary.noThresholdSet).toBe(false);
    expect(summary.noNextRound).toBe(false);
    expect(summary.nextRoundId).toBe('round-2');
    expect(summary.advancedCount).toBe(2);
    expect(summary.skippedAlreadyEnrolled).toBe(0);

    const advanced = h.state.inserts
      .filter((i) => i.table === roundQualifications)
      .map((i) => i.values.studentMembershipId)
      .sort();
    expect(advanced).toEqual(['m1', 'm2']);
    // Both qualified for the NEXT round, not the current one.
    for (const insert of h.state.inserts) {
      expect(insert.values.roundId).toBe('round-2');
    }
  });

  it('does not advance either entrant when both fall below the threshold', async () => {
    // 40/100 = 40% < 60% for both variants.
    h.state.submissionRows = [
      { studentMembershipId: 'm1', score: '40', status: 'submitted', variantQuestionIds: ['q1'] },
      { studentMembershipId: 'm2', score: '40', status: 'submitted', variantQuestionIds: ['q9'] },
    ];

    const summary = await advanceQualifyingEntrants('round-1');

    expect(summary.advancedCount).toBe(0);
    expect(h.state.inserts).toHaveLength(0);
  });
});
