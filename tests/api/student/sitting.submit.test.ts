import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/student/sitting/submit/route';
import {
  examSittings,
  memberships,
  questionPapers,
  submissions,
  studentAnswers,
  questions,
  rounds,
  results,
} from '@/lib/db/schema';

// The submit route reads the sitting join, saved answers, existing submission
// and existing result directly, then delegates the marking subset to
// `loadSittingQuestions` (mocked below so "scoped to the variant" is asserted
// deterministically) and the grading denominator to the real
// `getRoundTotalMarks`, which runs against this db mock via the `rounds` table.
// The mock tells `select()` calls apart by the table passed to `.from()`,
// records every update/insert, and is thenable at every chain step. Table
// identities are injected after import (vi.hoisted runs first).
const h = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    sittingData: null as any,
    savedAnswers: [] as any[],
    existingSubmission: null as any,
    variantQuestions: [] as any[], // what loadSittingQuestions resolves to
    roundQuestions: [] as any[], // questions table (getRoundTotalMarks pool)
    roundRows: [] as any[], // rounds table (getRoundTotalMarks target)
    existingResult: null as any,
    // When true, the submissions INSERT loses the ON CONFLICT DO NOTHING race
    // (a concurrent writer created the row first), so returning() resolves empty.
    conflictOnInsert: false,
    updates: [] as Array<{ table: any; values: any }>,
    inserts: [] as Array<{ table: any; values: any }>,
    tables: {} as Record<string, any>,
  };

  const rowsFor = (table: any): any[] => {
    if (table === state.tables.examSittings) return state.sittingData ? [state.sittingData] : [];
    if (table === state.tables.studentAnswers) return state.savedAnswers;
    if (table === state.tables.submissions)
      return state.existingSubmission ? [state.existingSubmission] : [];
    if (table === state.tables.questions) return state.roundQuestions;
    if (table === state.tables.rounds) return state.roundRows;
    if (table === state.tables.results) return state.existingResult ? [state.existingResult] : [];
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
    update: (table: any) => ({
      set: (values: any) => ({
        where: () => {
          state.updates.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: any) => ({
      values: (values: any) => {
        state.inserts.push({ table, values });
        const lostRace =
          state.conflictOnInsert && table === state.tables.submissions;
        const returned = lostRace
          ? []
          : table === state.tables.submissions
            ? [{ id: 'sub-new' }]
            : [{ id: 'row-new' }];
        const thenable: any = {
          onConflictDoNothing: () => thenable,
          returning: () => Promise.resolve(returned),
          then: (res: any, rej: any) => Promise.resolve(returned).then(res, rej),
        };
        return thenable;
      },
    }),
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  };

  return { state, db, supabase };
});

h.state.tables.examSittings = examSittings;
h.state.tables.memberships = memberships;
h.state.tables.questionPapers = questionPapers;
h.state.tables.submissions = submissions;
h.state.tables.studentAnswers = studentAnswers;
h.state.tables.questions = questions;
h.state.tables.rounds = rounds;
h.state.tables.results = results;

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));
// Isolate the marking subset: the route must mark exactly what the dealt
// variant resolves to, never the whole pool.
vi.mock('@/domain/question-bank/load-variant', () => ({
  loadSittingQuestions: vi.fn(async () => h.state.variantQuestions),
  orderByIds: (rows: any[]) => rows,
}));

import { loadSittingQuestions } from '@/domain/question-bank/load-variant';

// --- helpers ---------------------------------------------------------------

function submitReq(body: Record<string, any>) {
  return new Request('http://localhost:3000/api/student/sitting/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// The joined row the submit route expects: sitting + paper + membershipId.
function activeSitting(over: Record<string, any> = {}) {
  return {
    sitting: { id: 'sitting-1', status: 'active', startedAt: new Date(Date.now() - 60_000) },
    paper: { roundId: 'round-1' },
    membershipId: 'm1',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.user = { id: 'student-1' };
  h.state.sittingData = null;
  h.state.savedAnswers = [];
  h.state.existingSubmission = null;
  h.state.variantQuestions = [];
  h.state.roundQuestions = [];
  h.state.roundRows = [];
  h.state.existingResult = null;
  h.state.conflictOnInsert = false;
  h.state.updates = [];
  h.state.inserts = [];
});

describe('POST /api/student/sitting/submit', () => {
  it('returns 401 when the student is not authenticated', async () => {
    h.state.user = null;

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 when sittingId is missing', async () => {
    const res = await POST(submitReq({}));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Missing sittingId');
  });

  it('returns 404 when the sitting does not belong to the student', async () => {
    h.state.sittingData = null;

    const res = await POST(submitReq({ sittingId: 'nope' }));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Sitting not found');
  });

  it('is idempotent: a sitting that is not active is left untouched', async () => {
    h.state.sittingData = activeSitting({
      sitting: { id: 'sitting-1', status: 'submitted', startedAt: new Date() },
    });

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // No re-submission, no re-marking.
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
  });

  it('submits, auto-marks and records the grade on the happy path', async () => {
    h.state.sittingData = activeSitting();
    h.state.savedAnswers = [
      { questionId: 'q1', answerValue: 'B' },
      { questionId: 'q2', answerValue: 'some essay text' },
    ];
    h.state.existingSubmission = null; // forces the submission insert branch
    h.state.variantQuestions = [
      { id: 'q1', questionType: 'single_choice', marks: 2, correctAnswer: 'B' }, // correct -> 2
      { id: 'q2', questionType: 'free_text', marks: 5 }, // excluded from auto-marking
      { id: 'q3', questionType: 'single_choice', marks: 1, correctAnswer: 'A' }, // unanswered -> 0
    ];
    h.state.existingResult = null;

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    // The sitting was marked submitted.
    expect(
      h.state.updates.some((u) => u.table === examSittings && u.values.status === 'submitted')
    ).toBe(true);

    // A submission was created.
    expect(h.state.inserts.some((i) => i.table === submissions)).toBe(true);

    // The result was auto-marked: 2 of 3 auto-marked marks (free_text excluded).
    // No round target is configured, so the denominator falls back to the
    // auto-markable subtotal.
    const resultInsert = h.state.inserts.find((i) => i.table === results);
    expect(resultInsert).toBeTruthy();
    expect(resultInsert!.values).toMatchObject({
      score: '2',
      feedback: 'Auto-marked: 2 / 3',
      status: 'auto_marked',
    });
  });

  it('awards partial credit for a partly-correct multiple_choice answer', async () => {
    h.state.sittingData = activeSitting();
    h.state.savedAnswers = [{ questionId: 'q1', answerValue: '["A","C"]' }];
    h.state.existingSubmission = null;
    h.state.variantQuestions = [
      { id: 'q1', questionType: 'multiple_choice', marks: 4, correctAnswer: ['A', 'B'] },
    ];
    h.state.existingResult = null;

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    // 1 of 2 correct selections on a 4-mark question -> (1/2) * 4 = 2.
    const resultInsert = h.state.inserts.find((i) => i.table === results);
    expect(resultInsert!.values).toMatchObject({
      score: '2',
      feedback: 'Auto-marked: 2 / 4',
      status: 'auto_marked',
    });
  });

  it('marks only the dealt variant and ignores answers to out-of-variant questions', async () => {
    h.state.sittingData = activeSitting({
      sitting: {
        id: 'sitting-1',
        status: 'active',
        startedAt: new Date(Date.now() - 60_000),
        variantQuestionIds: ['q1'],
      },
    });
    h.state.savedAnswers = [
      { questionId: 'q1', answerValue: 'B' }, // in variant, correct -> 2
      { questionId: 'q9', answerValue: 'C' }, // smuggled, never resolved by the loader
    ];
    h.state.existingSubmission = null;
    // loadSittingQuestions resolves to the variant subset only.
    h.state.variantQuestions = [
      { id: 'q1', questionType: 'single_choice', marks: 2, correctAnswer: 'B' },
    ];
    h.state.existingResult = null;

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    // The marking loader was scoped to the sitting's variant for this round.
    expect(loadSittingQuestions).toHaveBeenCalledWith(
      { variantQuestionIds: ['q1'] },
      'round-1'
    );
    // Only q1 is scored; the out-of-variant q9 answer contributes nothing.
    const resultInsert = h.state.inserts.find((i) => i.table === results);
    expect(resultInsert!.values).toMatchObject({
      score: '2',
      feedback: 'Auto-marked: 2 / 2',
      status: 'auto_marked',
    });
  });

  it('copies the dealt variant onto the submission row', async () => {
    h.state.sittingData = activeSitting({
      sitting: {
        id: 'sitting-1',
        status: 'active',
        startedAt: new Date(Date.now() - 60_000),
        variantQuestionIds: ['q1', 'q2'],
      },
    });
    h.state.savedAnswers = [{ questionId: 'q1', answerValue: 'B' }];
    h.state.existingSubmission = null;
    h.state.variantQuestions = [
      { id: 'q1', questionType: 'single_choice', marks: 2, correctAnswer: 'B' },
      { id: 'q2', questionType: 'single_choice', marks: 1, correctAnswer: 'A' },
    ];
    h.state.existingResult = null;

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    const submissionInsert = h.state.inserts.find((i) => i.table === submissions);
    expect(submissionInsert!.values).toMatchObject({
      variantQuestionIds: ['q1', 'q2'],
    });
  });

  it('persists the round target as the denominator, not the auto-markable subtotal', async () => {
    h.state.sittingData = activeSitting();
    h.state.savedAnswers = [{ questionId: 'q1', answerValue: 'B' }];
    h.state.existingSubmission = null;
    // Auto-markable subtotal here is 3 (2 + 1), but the round target is 10.
    h.state.variantQuestions = [
      { id: 'q1', questionType: 'single_choice', marks: 2, correctAnswer: 'B' }, // correct -> 2
      { id: 'q3', questionType: 'single_choice', marks: 1, correctAnswer: 'A' }, // unanswered -> 0
    ];
    h.state.roundRows = [
      { id: 'round-1', targetTotalMarks: 10, paperTotalMarks: null },
    ];
    h.state.existingResult = null;

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    const resultInsert = h.state.inserts.find((i) => i.table === results);
    expect(resultInsert!.values).toMatchObject({
      score: '2',
      feedback: 'Auto-marked: 2 / 10',
      status: 'auto_marked',
    });
  });

  it('updates an existing submission and result instead of inserting duplicates', async () => {
    h.state.sittingData = activeSitting();
    h.state.savedAnswers = [{ questionId: 'q1', answerValue: 'A' }];
    h.state.existingSubmission = { id: 'sub-existing' };
    h.state.variantQuestions = [
      { id: 'q1', questionType: 'single_choice', marks: 1, correctAnswer: 'A' },
    ];
    h.state.existingResult = { id: 'res-existing' };

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    // No new submission row; the existing one was updated.
    expect(h.state.inserts.some((i) => i.table === submissions)).toBe(false);
    expect(
      h.state.updates.some((u) => u.table === submissions && u.values.status === 'submitted')
    ).toBe(true);
    // The existing result was updated with the new score.
    expect(
      h.state.updates.some((u) => u.table === results && u.values.score === '1')
    ).toBe(true);
  });

  it('leaves an offline submission and its mark untouched (first is final)', async () => {
    // A hybrid round the educator already marked offline before the entrant
    // submitted online: the offline record is authoritative and must survive.
    h.state.sittingData = activeSitting();
    h.state.savedAnswers = [{ questionId: 'q1', answerValue: 'A' }];
    h.state.existingSubmission = {
      id: 'sub-offline',
      status: 'submitted',
      submissionType: 'offline',
    };
    h.state.variantQuestions = [
      { id: 'q1', questionType: 'single_choice', marks: 1, correctAnswer: 'A' },
    ];
    h.state.existingResult = { id: 'res-offline', score: '50' };

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // The sitting is still flagged submitted, but the offline submission and its
    // result are neither inserted nor overwritten.
    expect(
      h.state.updates.some((u) => u.table === examSittings && u.values.status === 'submitted')
    ).toBe(true);
    expect(h.state.inserts.some((i) => i.table === submissions)).toBe(false);
    expect(h.state.updates.some((u) => u.table === submissions)).toBe(false);
    expect(h.state.inserts.some((i) => i.table === results)).toBe(false);
    expect(h.state.updates.some((u) => u.table === results)).toBe(false);
  });

  it('bows out without marking when it loses the insert race (concurrent submit)', async () => {
    // Two submits land at once: the SELECT sees nothing, but a concurrent writer
    // creates the row first, so ON CONFLICT DO NOTHING returns no row and this
    // request stops without marking anything over the winner (first is final).
    h.state.sittingData = activeSitting();
    h.state.savedAnswers = [{ questionId: 'q1', answerValue: 'B' }];
    h.state.existingSubmission = null;
    h.state.conflictOnInsert = true;
    h.state.variantQuestions = [
      { id: 'q1', questionType: 'single_choice', marks: 2, correctAnswer: 'B' },
    ];
    h.state.existingResult = null;

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // The insert was attempted, but no result was auto-marked over the winner.
    expect(h.state.inserts.some((i) => i.table === submissions)).toBe(true);
    expect(h.state.inserts.some((i) => i.table === results)).toBe(false);
    expect(h.state.updates.some((u) => u.table === results)).toBe(false);
  });
});

// A matching question is ONE student_answers row under its BASE question uuid
// whose answer_value is the aggregated JSON object of pair selections — that is
// the only shape the uuid `question_id` column can hold. Submit must reassemble
// that payload before marking, otherwise `answersObj[q.id]` is undefined and
// every matching question is silently scored 0.
describe('POST /api/student/sitting/submit — matching questions', () => {
  const Q_MATCH = '3f2b8c1e-6d4a-4f9b-9c2e-8a1d5e7f0b34';
  const Q_SINGLE = '8a1d5e7f-0b34-4c2e-9f6d-4a3f2b8c1e6d';
  const PAIRS = [
    { premise: 'France', response: 'Paris' },
    { premise: 'Italy', response: 'Rome' },
    { premise: 'Spain', response: 'Madrid' },
  ];
  const matchingQuestion = (marks = 6) => ({
    id: Q_MATCH,
    questionType: 'matching',
    marks,
    correctAnswer: null,
    options: PAIRS,
  });
  const singleQuestion = {
    id: Q_SINGLE,
    questionType: 'single_choice',
    marks: 2,
    correctAnswer: 'B',
    options: ['A', 'B'],
  };

  /** The aggregated payload the save route persists under the base uuid. */
  const aggregate = (selections: Array<string | undefined>) =>
    JSON.stringify(
      Object.fromEntries(
        selections
          .map((value, index) => [`${Q_MATCH}_${index}`, value] as const)
          .filter(([, value]) => value !== undefined)
      )
    );

  beforeEach(() => {
    h.state.sittingData = activeSitting();
    h.state.existingSubmission = null;
    h.state.existingResult = null;
  });

  const resultValues = () => h.state.inserts.find((i) => i.table === results)!.values;

  it('auto-marks a matching question with proportional credit', async () => {
    h.state.savedAnswers = [
      { questionId: Q_SINGLE, answerValue: 'B' }, // correct -> 2
      // Two of three pairs correct -> 4 of 6.
      { questionId: Q_MATCH, answerValue: aggregate(['Paris', 'Rome', 'Berlin']) },
    ];
    h.state.variantQuestions = [singleQuestion, matchingQuestion(6)];

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    // 2 + 4 = 6, NOT the 2 the composite-key lookup used to produce.
    expect(resultValues()).toMatchObject({
      score: '6',
      feedback: 'Auto-marked: 6 / 8',
      status: 'auto_marked',
    });
  });

  it('awards full matching marks when every pair is right', async () => {
    h.state.savedAnswers = [
      { questionId: Q_MATCH, answerValue: aggregate(['Paris', 'Rome', 'Madrid']) },
    ];
    h.state.variantQuestions = [matchingQuestion(6)];

    await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(resultValues()).toMatchObject({ score: '6', feedback: 'Auto-marked: 6 / 6' });
  });

  it('keeps matching at zero without failing the submission when nothing was chosen', async () => {
    h.state.savedAnswers = [{ questionId: Q_SINGLE, answerValue: 'B' }];
    h.state.variantQuestions = [singleQuestion, matchingQuestion(6)];

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    expect(resultValues()).toMatchObject({ score: '2', feedback: 'Auto-marked: 2 / 8' });
  });

  it('rounds the fractional marks proportional matching credit produces', async () => {
    h.state.savedAnswers = [
      // One of three pairs on a 5-mark question -> 1.666… -> 1.67.
      { questionId: Q_MATCH, answerValue: aggregate(['Paris']) },
    ];
    h.state.variantQuestions = [matchingQuestion(5)];

    await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(resultValues()).toMatchObject({ score: '1.67', feedback: 'Auto-marked: 1.67 / 5' });
  });

  it('folds composite answer rows into the base question id before marking', async () => {
    // Defensive: rows keyed by `${qid}_${index}` (what the exam UI posts, and
    // what answers_json can hold) must still reach the matching branch.
    h.state.savedAnswers = [
      { questionId: `${Q_MATCH}_0`, answerValue: 'Paris' },
      { questionId: `${Q_MATCH}_1`, answerValue: 'Rome' },
      { questionId: Q_SINGLE, answerValue: 'B' },
    ];
    h.state.variantQuestions = [singleQuestion, matchingQuestion(3)];

    await POST(submitReq({ sittingId: 'sitting-1' }));

    // 2 (single) + two of three pairs on a 3-mark question = 4.
    expect(resultValues()).toMatchObject({ score: '4', feedback: 'Auto-marked: 4 / 5' });
  });

  it('persists answers_json keyed by base question id only', async () => {
    h.state.savedAnswers = [
      { questionId: Q_SINGLE, answerValue: 'B' },
      { questionId: `${Q_MATCH}_0`, answerValue: 'Paris' },
      { questionId: `${Q_MATCH}_1`, answerValue: 'Rome' },
    ];
    h.state.variantQuestions = [singleQuestion, matchingQuestion(6)];

    await POST(submitReq({ sittingId: 'sitting-1' }));

    const submissionInsert = h.state.inserts.find((i) => i.table === submissions)!;
    const answersJson = submissionInsert.values.answersJson as Record<string, string>;

    // The educator marking screen re-marks with `answersObj[q.id]`, so the
    // persisted map must be keyed by base question id only.
    expect(Object.keys(answersJson).sort()).toEqual([Q_MATCH, Q_SINGLE].sort());
    expect(Object.keys(answersJson).some((k) => /_\d+$/.test(k))).toBe(false);
    expect(JSON.parse(answersJson[Q_MATCH])).toEqual({
      [`${Q_MATCH}_0`]: 'Paris',
      [`${Q_MATCH}_1`]: 'Rome',
    });
    expect(answersJson[Q_SINGLE]).toBe('B');
  });

  it('uses the round target as the denominator while matching is auto-marked', async () => {
    h.state.savedAnswers = [
      { questionId: Q_MATCH, answerValue: aggregate(['Paris', 'Rome', 'Berlin']) },
    ];
    h.state.variantQuestions = [matchingQuestion(6)];
    h.state.roundRows = [{ id: 'round-1', targetTotalMarks: 20, paperTotalMarks: null }];

    await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(resultValues()).toMatchObject({ score: '4', feedback: 'Auto-marked: 4 / 20' });
  });

  it('leaves free text to educators next to an auto-marked matching question', async () => {
    h.state.savedAnswers = [
      { questionId: Q_MATCH, answerValue: aggregate(['Paris', 'Rome', 'Madrid']) },
      { questionId: 'q-free', answerValue: 'A written explanation' },
    ];
    h.state.variantQuestions = [
      matchingQuestion(6),
      { id: 'q-free', questionType: 'free_text', marks: 4, correctAnswer: null, options: null },
    ];

    await POST(submitReq({ sittingId: 'sitting-1' }));

    // 6 from matching; the 4 free-text marks stay out of the auto-markable
    // subtotal until an educator grades them.
    expect(resultValues()).toMatchObject({ score: '6', feedback: 'Auto-marked: 6 / 6' });
  });

  it('re-marks an existing result when the matching answers change', async () => {
    h.state.existingSubmission = { id: 'sub-existing' };
    h.state.existingResult = { id: 'res-existing' };
    h.state.savedAnswers = [
      { questionId: Q_MATCH, answerValue: aggregate(['Paris', 'Rome', 'Madrid']) },
    ];
    h.state.variantQuestions = [matchingQuestion(6)];

    const res = await POST(submitReq({ sittingId: 'sitting-1' }));

    expect(res.status).toBe(200);
    expect(
      h.state.updates.some((u) => u.table === results && u.values.score === '6')
    ).toBe(true);
    expect(h.state.inserts.some((i) => i.table === results)).toBe(false);
  });
});
