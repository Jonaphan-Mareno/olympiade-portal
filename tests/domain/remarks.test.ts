import { describe, it, expect, vi, beforeEach } from 'vitest';

// Queries run in a fixed order, so selects are served from a FIFO queue.
// Updates are recorded; `.returning()` yields state.returning.
// `loadSittingQuestions` is mocked so "resolved over the variant" is asserted
// deterministically (it otherwise issues its own questions select).
const state = vi.hoisted(() => ({
  queue: [] as any[][],
  updates: [] as any[],
  returning: [{ id: 'remark-1' }] as any[],
  variantQuestions: [] as any[],
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => {
        const chain: any = {
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: () => Promise.resolve(state.queue.shift() ?? []),
        };
        return chain;
      },
    }),
    update: () => ({
      set: (values: any) => ({
        where: () => {
          state.updates.push(values);
          const p: any = Promise.resolve();
          p.returning = () => Promise.resolve(state.returning);
          return p;
        },
      }),
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  },
}));

vi.mock('@/domain/question-bank/load-variant', () => ({
  loadSittingQuestions: vi.fn(async () => state.variantQuestions),
  orderByIds: (rows: any[]) => rows,
}));

vi.mock('@/domain/rounds/advance-entrants', () => ({
  advanceQualifyingEntrants: vi.fn(async () => null),
}));
vi.mock('@/domain/notifications/in-app-notifications', () => ({
  notifyEducatorsInPortal: vi.fn(async () => {}),
}));

import {
  getQuestionMarks,
  getRemarkEligibility,
  resolveRemarkRequest,
  REMARK_WINDOW_DAYS,
} from '@/domain/remarks/remarks';
import { loadSittingQuestions } from '@/domain/question-bank/load-variant';
import { advanceQualifyingEntrants } from '@/domain/rounds/advance-entrants';

const DAY = 24 * 60 * 60 * 1000;
const published = new Date('2026-09-01T10:00:00Z');

describe('getRemarkEligibility', () => {
  const base = { resultsPublishedAt: published, hasScore: true, hasExistingRequest: false };

  it('allows an appeal within the window after publication', () => {
    const e = getRemarkEligibility(base, new Date(published.getTime() + 3 * DAY));
    expect(e.eligible).toBe(true);
  });

  it('closes the window after REMARK_WINDOW_DAYS', () => {
    const e = getRemarkEligibility(
      base,
      new Date(published.getTime() + (REMARK_WINDOW_DAYS + 1) * DAY)
    );
    expect(e.eligible).toBe(false);
  });

  it('requires published results, a mark, and no earlier appeal', () => {
    const now = new Date(published.getTime() + DAY);
    expect(getRemarkEligibility({ ...base, resultsPublishedAt: null }, now).eligible).toBe(false);
    expect(getRemarkEligibility({ ...base, hasScore: false }, now).eligible).toBe(false);
    expect(getRemarkEligibility({ ...base, hasExistingRequest: true }, now).eligible).toBe(false);
  });
});

describe('resolveRemarkRequest', () => {
  const request = {
    id: 'remark-1',
    submissionId: 'sub-1',
    reason: 'Q1 was right',
    status: 'pending',
    previousScore: '2',
    currentScore: '2',
    roundId: 'round-1',
    roundName: 'Round 1',
    portalId: 'portal-1',
    submissionType: 'online',
    studentMembershipId: 'stu-1',
    studentSchoolId: 'school-1',
  };
  const question = (id: string, marks: number) => ({
    id,
    prompt: `Prompt ${id}`,
    questionType: 'single_choice',
    marks,
    correctAnswer: 'A',
    options: ['A', 'B'],
  });

  function queueOnline(variantQuestionIds: string[] | null = null) {
    // loadSittingQuestions is mocked, so the variant's questions come from
    // state.variantQuestions rather than a db select.
    state.variantQuestions = [question('q1', 4), question('q2', 2)];
    state.queue = [
      [request], // getRemarkRequest
      [{ ownerUserId: 'organiser' }], // canResolveRemark: portal owner
      [{
        roundId: 'round-1',
        studentMembershipId: 'stu-1',
        answersJson: { q1: 'B', q2: 'A' },
        variantQuestionIds,
      }],
      [], // existing remark marks
      [], // educator marks
      [{ resultsPublishedAt: published }], // round lookup for advancement
    ];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.updates = [];
    state.returning = [{ id: 'remark-1' }];
    state.variantQuestions = [];
  });

  it('writes the remarked total to the result and re-runs advancement', async () => {
    queueOnline();

    const res = await resolveRemarkRequest('organiser', {
      requestId: 'remark-1',
      note: 'Q1 accepted.',
      questionMarks: { q1: 4 }, // q2 keeps its current 2 marks
    });

    expect(res).toEqual({ newScore: 6 });
    expect(state.updates[0]).toMatchObject({
      status: 'resolved',
      newScore: '6',
      questionMarks: { q1: 4, q2: 2 },
      responseNote: 'Q1 accepted.',
    });
    expect(state.updates[1]).toMatchObject({
      score: '6',
      status: 'remark_resolved',
      remarkOutcome: 'Mark changed from 2 to 6. Q1 accepted.',
    });
    expect(advanceQualifyingEntrants).toHaveBeenCalledWith('round-1');
  });

  it('resolves question marks over the submission variant, not the whole pool', async () => {
    queueOnline(['q1', 'q2']);

    const res = await resolveRemarkRequest('organiser', {
      requestId: 'remark-1',
      note: 'Scoped to the dealt variant.',
      questionMarks: { q1: 4 },
    });

    expect(res).toEqual({ newScore: 6 });
    // getQuestionMarks must ask the loader for exactly the dealt variant so a
    // remark can never touch pool questions the student was not dealt.
    expect(loadSittingQuestions).toHaveBeenCalledWith(
      { variantQuestionIds: ['q1', 'q2'] },
      'round-1'
    );
    expect(state.updates[0]).toMatchObject({
      questionMarks: { q1: 4, q2: 2 },
    });
  });

  it('rejects marks above a question maximum', async () => {
    queueOnline();

    const res = await resolveRemarkRequest('organiser', {
      requestId: 'remark-1',
      note: 'x',
      questionMarks: { q1: 5 },
    });

    expect(res.error).toContain('Question 1');
    expect(state.updates).toHaveLength(0);
  });

  it('refuses users who are neither the organiser nor the school educator', async () => {
    state.queue = [[request], [{ ownerUserId: 'organiser' }], []];

    const res = await resolveRemarkRequest('someone-else', {
      requestId: 'remark-1',
      note: 'x',
    });

    expect(res.error).toMatch(/not allowed/);
    expect(state.updates).toHaveLength(0);
  });

  it('takes a new total for paper rounds', async () => {
    state.queue = [
      [{ ...request, submissionType: 'offline' }],
      [{ ownerUserId: 'organiser' }],
      [{ resultsPublishedAt: null }],
    ];

    const res = await resolveRemarkRequest('organiser', {
      requestId: 'remark-1',
      note: 'Re-added page 3.',
      newTotal: 7.5,
    });

    expect(res).toEqual({ newScore: 7.5 });
    expect(state.updates[1]).toMatchObject({ score: '7.5' });
    expect(advanceQualifyingEntrants).not.toHaveBeenCalled();
  });
});

// `getQuestionMarks` is what the remark dialog, the review page and the appeal
// outcome all read. A matching question is stored as ONE aggregated payload
// under its base question uuid, so the marks here must be reassembled exactly
// like the submit route does or every appeal on a matching question starts at 0.
describe('getQuestionMarks', () => {
  const Q_MATCH = '3f2b8c1e-6d4a-4f9b-9c2e-8a1d5e7f0b34';
  const PAIRS = [
    { premise: 'France', response: 'Paris' },
    { premise: 'Italy', response: 'Rome' },
    { premise: 'Spain', response: 'Madrid' },
  ];
  const matching = {
    id: Q_MATCH,
    prompt: 'Match each country to its capital',
    questionType: 'matching',
    marks: 6,
    correctAnswer: null,
    options: PAIRS,
  };
  const freeText = {
    id: 'q-free',
    prompt: 'Explain photosynthesis',
    questionType: 'free_text',
    marks: 4,
    correctAnswer: null,
    options: null,
  };

  /**
   * Queue for one getQuestionMarks call: the submission row, the remark
   * request, then the educator's manual scores (only when the submission has a
   * studentMembershipId — otherwise no third select happens).
   */
  function queue(opts: {
    questions: any[];
    answersJson: Record<string, unknown>;
    remark?: any[];
    manualScores?: any[];
    studentMembershipId?: string | null;
  }) {
    state.variantQuestions = opts.questions;
    state.queue = [
      [
        {
          roundId: 'round-1',
          studentMembershipId: opts.studentMembershipId ?? null,
          answersJson: opts.answersJson,
          variantQuestionIds: null,
        },
      ],
      opts.remark ?? [],
    ];
    if (opts.studentMembershipId) state.queue.push(opts.manualScores ?? []);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.queue = [];
    state.variantQuestions = [];
  });

  it('returns nothing for an unknown submission', async () => {
    state.queue = [[]];
    await expect(getQuestionMarks('missing')).resolves.toEqual([]);
  });

  it('marks a matching question from the aggregated payload under the base id', async () => {
    queue({
      questions: [matching],
      answersJson: {
        [Q_MATCH]: JSON.stringify({
          [`${Q_MATCH}_0`]: 'Paris',
          [`${Q_MATCH}_1`]: 'Rome',
          [`${Q_MATCH}_2`]: 'Berlin',
        }),
      },
    });

    const [mark] = await getQuestionMarks('sub-1');

    // 2 of 3 pairs -> 4 of 6 (the bug this guards: reading the base id of a
    // composite-keyed map yielded undefined and marked the question 0).
    expect(mark.marks).toBe(4);
    expect(mark.maxMarks).toBe(6);
    expect(mark.manuallyMarked).toBe(false);
    expect(mark.studentAnswer).toBe('France → Paris; Italy → Rome; Spain → Berlin');
    expect(mark.correctAnswer).toBe('France → Paris; Italy → Rome; Spain → Madrid');
  });

  it('reassembles legacy per-pair answer keys before marking', async () => {
    queue({
      questions: [matching],
      answersJson: {
        [`${Q_MATCH}_0`]: 'Paris',
        [`${Q_MATCH}_1`]: 'Rome',
        [`${Q_MATCH}_2`]: 'Madrid',
      },
    });

    const [mark] = await getQuestionMarks('sub-1');
    expect(mark.marks).toBe(6);
  });

  it('renders an unanswered matching question as unselected pairs, not JSON', async () => {
    queue({ questions: [matching], answersJson: {} });

    const [mark] = await getQuestionMarks('sub-1');
    expect(mark.marks).toBe(0);
    expect(mark.studentAnswer).toBe('France → —; Italy → —; Spain → —');
  });

  it('takes a free-text mark from the educator score and flags it as marked', async () => {
    queue({
      questions: [freeText, matching],
      answersJson: { [Q_MATCH]: JSON.stringify({ [`${Q_MATCH}_0`]: 'Paris' }) },
      studentMembershipId: 'stu-1',
      manualScores: [{ questionId: 'q-free', manualScore: '3' }],
    });

    const marks = await getQuestionMarks('sub-1');
    expect(marks[0]).toMatchObject({
      questionId: 'q-free',
      questionType: 'free_text',
      marks: 3,
      maxMarks: 4,
      manuallyMarked: true,
      correctAnswer: 'Educator-marked',
    });
    // Auto-marking still runs for the other questions in the same script.
    expect(marks[1]).toMatchObject({ questionId: Q_MATCH, marks: 2, manuallyMarked: false });
    // The per-question marks add up to the total an appeal would write.
    expect(marks.reduce((sum, m) => sum + m.marks, 0)).toBe(5);
  });

  it('leaves an unmarked free-text answer at zero without claiming it was marked', async () => {
    queue({
      questions: [freeText],
      answersJson: { 'q-free': 'Chlorophyll absorbs light.' },
      studentMembershipId: 'stu-1',
      // A saved answer row with no educator score yet.
      manualScores: [{ questionId: 'q-free', manualScore: null }],
    });

    const [mark] = await getQuestionMarks('sub-1');
    expect(mark.marks).toBe(0);
    expect(mark.manuallyMarked).toBe(false);
    expect(mark.studentAnswer).toBe('Chlorophyll absorbs light.');
  });

  it('lets a resolved remark override both the auto-marker and the educator', async () => {
    queue({
      questions: [matching, freeText],
      answersJson: {},
      studentMembershipId: 'stu-1',
      manualScores: [{ questionId: 'q-free', manualScore: '1' }],
      remark: [
        { status: 'resolved', questionMarks: { [Q_MATCH]: 6, 'q-free': 4 } },
      ],
    });

    const marks = await getQuestionMarks('sub-1');
    expect(marks.map((m) => m.marks)).toEqual([6, 4]);
    expect(marks.every((m) => m.manuallyMarked)).toBe(true);
  });

  it('ignores a pending remark so the current marks stay visible', async () => {
    queue({
      questions: [matching],
      answersJson: { [Q_MATCH]: JSON.stringify({ [`${Q_MATCH}_0`]: 'Paris' }) },
      remark: [{ status: 'pending', questionMarks: { [Q_MATCH]: 6 } }],
    });

    const [mark] = await getQuestionMarks('sub-1');
    expect(mark.marks).toBe(2);
    expect(mark.manuallyMarked).toBe(false);
  });
});
