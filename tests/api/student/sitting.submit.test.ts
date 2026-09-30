import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/student/sitting/submit/route';
import {
  examSittings,
  memberships,
  questionPapers,
  submissions,
  studentAnswers,
  questions,
  results,
} from '@/lib/db/schema';

// The submit route reads five tables (sitting join, saved answers, existing
// submission, round questions, existing result) and writes to three (sitting
// update, submission insert/update, result insert/update). The db mock tells the
// `select()` calls apart by the table passed to `.from()`, records every
// update/insert, and is thenable at every chain step. Table identities are
// injected after import (vi.hoisted runs first).
const h = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    sittingData: null as any,
    savedAnswers: [] as any[],
    existingSubmission: null as any,
    roundQuestions: [] as any[],
    existingResult: null as any,
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
        const returned =
          table === state.tables.submissions ? [{ id: 'sub-new' }] : [{ id: 'row-new' }];
        const thenable: any = {
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
h.state.tables.results = results;

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));

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
  h.state.roundQuestions = [];
  h.state.existingResult = null;
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
    h.state.roundQuestions = [
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
    h.state.roundQuestions = [
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

  it('updates an existing submission and result instead of inserting duplicates', async () => {
    h.state.sittingData = activeSitting();
    h.state.savedAnswers = [{ questionId: 'q1', answerValue: 'A' }];
    h.state.existingSubmission = { id: 'sub-existing' };
    h.state.roundQuestions = [
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
});
