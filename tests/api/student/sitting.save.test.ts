import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/student/sitting/save/route';
import { examSittings, questions, studentAnswers } from '@/lib/db/schema';
import { isUuid } from '@/domain/marking/auto-mark';

// The save route reads the sitting (joined to its paper and round), enforces the
// attempt deadline, then upserts the answer. The db mock discriminates the
// `select()` calls by the table passed to `.from()` — the identities are injected
// after import because `vi.hoisted` runs first.
const h = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    sittingRow: null as any,
    questionRow: null as any,
    // The already-stored answer row for a matching question (the aggregate read
    // the route performs before merging one more pair into it).
    existingAnswerRow: null as any,
    updates: [] as Array<{ table: any; values: any }>,
    inserts: [] as Array<{ table: any; values: any }>,
    conflicts: [] as Array<{ table: any; values: any; options: any }>,
    sittingsTable: null as any,
    questionsTable: null as any,
    studentAnswersTable: null as any,
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
        where: () => chain,
        limit: () => {
          const rows =
            captured === state.sittingsTable
              ? state.sittingRow
                ? [state.sittingRow]
                : []
              : captured === state.questionsTable
                ? state.questionRow
                  ? [state.questionRow]
                  : []
                : captured === state.studentAnswersTable
                  ? state.existingAnswerRow
                    ? [state.existingAnswerRow]
                    : []
                  : [];
          return Promise.resolve(rows);
        },
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
        return {
          onConflictDoUpdate: (options: any) => {
            state.conflicts.push({ table, values, options });
            return Promise.resolve();
          },
        };
      },
    }),
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  };

  return { state, db, supabase };
});

h.state.sittingsTable = examSittings;
h.state.questionsTable = questions;
h.state.studentAnswersTable = studentAnswers;

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));

// --- helpers ---------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// `student_answers.question_id` / `sitting_id` are uuid columns, so every
// fixture id has to be a real uuid: a composite key such as `${Q1}_0` is only
// ever a transport key and must never reach the column.
const SITTING = '11111111-1111-4111-8111-111111111111';
const Q1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const Q2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const Q3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const OTHER_ROUND_QUESTION = 'aaaaaaaa-0000-4000-8000-000000000009';

function saveReq(body: Record<string, any>) {
  return new Request('http://localhost:3000/api/student/sitting/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Builds a sitting row relative to the real clock so no fake timers are needed.
// `variantQuestionIds` mirrors the dealt variant: an array enforces membership,
// `null` (default) is a legacy sitting guarded only by the round-scoped check.
function sittingRow({
  startedAgoMs,
  durationMinutes,
  closesInMs,
  status = 'active',
  variantQuestionIds = null,
}: {
  startedAgoMs: number;
  durationMinutes: number;
  closesInMs: number;
  status?: string;
  variantQuestionIds?: string[] | null;
}) {
  const now = Date.now();
  return {
    sitting: {
      id: SITTING,
      status,
      startedAt: new Date(now - startedAgoMs),
      variantQuestionIds,
    },
    membership: { id: 'm1' },
    paper: { durationMinutes, roundId: 'round-1' },
    round: { closesAt: new Date(now + closesInMs) },
  };
}

// An open attempt with plenty of time left, so only the behaviour under test
// decides the outcome.
function openSitting(variantQuestionIds: string[] | null = null) {
  return sittingRow({
    startedAgoMs: 10 * MIN,
    durationMinutes: 120,
    closesInMs: 3 * DAY,
    variantQuestionIds,
  });
}

const payload = { sittingId: SITTING, questionId: Q1, answerValue: 'A' };

function answerInsert() {
  return h.state.inserts.find((i) => i.table === studentAnswers);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.user = { id: 'student-1' };
  h.state.sittingRow = null;
  h.state.questionRow = { id: Q1, roundId: 'round-1', questionType: 'single_choice' };
  h.state.existingAnswerRow = null;
  h.state.updates = [];
  h.state.inserts = [];
  h.state.conflicts = [];
});

describe('POST /api/student/sitting/save', () => {
  it('returns 401 when the student is not authenticated', async () => {
    h.state.user = null;

    const res = await POST(saveReq(payload));

    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(saveReq({ sittingId: SITTING }));

    expect(res.status).toBe(400);
  });

  it('returns 404 when the sitting is not found', async () => {
    h.state.sittingRow = null;

    const res = await POST(saveReq(payload));

    expect(res.status).toBe(404);
  });

  it('expires the attempt once the round has closed even though start + duration has not elapsed (the closesAt cap)', async () => {
    // Started 2h ago with a 2880-min (2-day) limit -> the relative end is ~46h
    // away, but the round closed 1h ago. The cap makes the deadline "now - 1h",
    // so the attempt is expired and force-submitted, and the answer is not saved.
    h.state.sittingRow = sittingRow({
      startedAgoMs: 2 * HOUR,
      durationMinutes: 2880,
      closesInMs: -1 * HOUR,
    });

    const res = await POST(saveReq(payload));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Time has expired');
    expect(
      h.state.updates.some(
        (u) => u.table === examSittings && u.values.status === 'submitted'
      )
    ).toBe(true);
    expect(h.state.inserts).toHaveLength(0);
  });

  it('expires the attempt when the relative time limit passes before the round closes', async () => {
    // Started 2h ago with a 60-min limit -> deadline was 1h ago; the round does
    // not close for 3 days, so the relative limit (the earlier bound) governs.
    h.state.sittingRow = sittingRow({
      startedAgoMs: 2 * HOUR,
      durationMinutes: 60,
      closesInMs: 3 * DAY,
    });

    const res = await POST(saveReq(payload));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Time has expired');
  });

  it('saves the answer while the attempt is inside the capped window', async () => {
    h.state.sittingRow = openSitting();

    const res = await POST(saveReq(payload));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(answerInsert()).toBeTruthy();
    expect(answerInsert()!.values).toMatchObject({
      sittingId: SITTING,
      questionId: Q1,
      answerValue: 'A',
    });
  });

  it('rejects a question that does not belong to this test', async () => {
    h.state.sittingRow = openSitting();
    h.state.questionRow = { id: OTHER_ROUND_QUESTION, roundId: 'some-other-round' };

    const res = await POST(saveReq({
      sittingId: SITTING,
      questionId: OTHER_ROUND_QUESTION,
      answerValue: 'A',
    }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Question does not belong to this test');
    expect(h.state.inserts).toHaveLength(0);
  });

  it('rejects a question outside the dealt variant even though it belongs to the round', async () => {
    h.state.sittingRow = openSitting([Q1, Q2]);
    // Q3 is a legitimate round question but was NOT dealt to this student.
    h.state.questionRow = { id: Q3, roundId: 'round-1', questionType: 'single_choice' };

    const res = await POST(saveReq({ sittingId: SITTING, questionId: Q3, answerValue: 'A' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Question is not part of your assigned test');
    expect(h.state.inserts).toHaveLength(0);
  });

  it('accepts any in-round question for a legacy sitting with a null variant', async () => {
    h.state.sittingRow = openSitting(null);
    h.state.questionRow = { id: Q3, roundId: 'round-1', questionType: 'single_choice' };

    const res = await POST(saveReq({ sittingId: SITTING, questionId: Q3, answerValue: 'A' }));

    expect(res.status).toBe(200);
    expect(answerInsert()!.values.questionId).toBe(Q3);
  });
});

// `student_answers.question_id` is a uuid column (drizzle/0004 adds it as
// `uuid`), so persisting the composite `${uuid}_${index}` key the exam UI posts
// fails with 22P02 and loses the sub-answer. These tests pin the aggregation
// that keeps matching usable: ONE row under the base uuid whose answer_value is
// the JSON object the auto-marker's matching branch reads.
describe('POST /api/student/sitting/save — matching sub-answers', () => {
  beforeEach(() => {
    h.state.sittingRow = openSitting([Q1]);
    h.state.questionRow = { id: Q1, roundId: 'round-1', questionType: 'matching' };
  });

  it('persists a pair under the BASE uuid as an aggregated JSON payload', async () => {
    const res = await POST(saveReq({
      sittingId: SITTING,
      questionId: `${Q1}_0`,
      answerValue: 'Paris',
    }));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const insert = answerInsert()!;
    // Never the composite key: it would violate the uuid column type.
    expect(insert.values.questionId).toBe(Q1);
    expect(isUuid(insert.values.questionId)).toBe(true);
    expect(JSON.parse(insert.values.answerValue)).toEqual({ [`${Q1}_0`]: 'Paris' });
  });

  it('keeps the pairs already stored when a later pair is saved', async () => {
    // Pair 0 is on the server; pair 1 arrives next.
    h.state.existingAnswerRow = {
      answerValue: JSON.stringify({ [`${Q1}_0`]: 'Paris' }),
    };

    const res = await POST(saveReq({
      sittingId: SITTING,
      questionId: `${Q1}_1`,
      answerValue: 'Rome',
    }));

    expect(res.status).toBe(200);
    expect(JSON.parse(answerInsert()!.values.answerValue)).toEqual({
      [`${Q1}_0`]: 'Paris',
      [`${Q1}_1`]: 'Rome',
    });
  });

  it('overwrites one pair without touching the others', async () => {
    h.state.existingAnswerRow = {
      answerValue: JSON.stringify({ [`${Q1}_0`]: 'Paris', [`${Q1}_1`]: 'Rome' }),
    };

    const res = await POST(saveReq({
      sittingId: SITTING,
      questionId: `${Q1}_0`,
      answerValue: 'Berlin',
    }));

    expect(res.status).toBe(200);
    expect(JSON.parse(answerInsert()!.values.answerValue)).toEqual({
      [`${Q1}_0`]: 'Berlin',
      [`${Q1}_1`]: 'Rome',
    });
  });

  it('replaces a non-JSON stored value (e.g. an educator moderation row) instead of failing', async () => {
    h.state.existingAnswerRow = { answerValue: '' };

    const res = await POST(saveReq({
      sittingId: SITTING,
      questionId: `${Q1}_2`,
      answerValue: 'Madrid',
    }));

    expect(res.status).toBe(200);
    expect(JSON.parse(answerInsert()!.values.answerValue)).toEqual({ [`${Q1}_2`]: 'Madrid' });
  });

  it('upserts on the unique (sitting_id, question_id) pair', async () => {
    await POST(saveReq({ sittingId: SITTING, questionId: `${Q1}_0`, answerValue: 'Paris' }));

    const conflict = h.state.conflicts.find((c) => c.table === studentAnswers);
    expect(conflict).toBeTruthy();
    expect(conflict!.options.target).toEqual([
      studentAnswers.sittingId,
      studentAnswers.questionId,
    ]);
  });

  it('rejects a composite key aimed at a question that is not a matching question', async () => {
    h.state.questionRow = { id: Q1, roundId: 'round-1', questionType: 'single_choice' };

    const res = await POST(saveReq({
      sittingId: SITTING,
      questionId: `${Q1}_0`,
      answerValue: 'A',
    }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Question does not accept paired answers');
    expect(h.state.inserts).toHaveLength(0);
  });

  it('still enforces variant membership on the base id of a composite key', async () => {
    // Q2 is a matching question in the round but was not dealt to this student.
    h.state.sittingRow = openSitting([Q1]);
    h.state.questionRow = { id: Q2, roundId: 'round-1', questionType: 'matching' };

    const res = await POST(saveReq({
      sittingId: SITTING,
      questionId: `${Q2}_0`,
      answerValue: 'Paris',
    }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Question is not part of your assigned test');
    expect(h.state.inserts).toHaveLength(0);
  });
});

// A malformed id used to travel all the way to Postgres and come back as a
// 22P02 500. The route now rejects it as the client error it is.
describe('POST /api/student/sitting/save — uuid guards', () => {
  it('returns 400 for a question id that is not a uuid', async () => {
    h.state.sittingRow = openSitting();

    const res = await POST(saveReq({ sittingId: SITTING, questionId: 'q1', answerValue: 'A' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid question id');
    expect(h.state.inserts).toHaveLength(0);
  });

  it('returns 400 for a composite key whose base id is not a uuid', async () => {
    h.state.sittingRow = openSitting();

    const res = await POST(saveReq({ sittingId: SITTING, questionId: 'q1_0', answerValue: 'A' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid question id');
    expect(h.state.inserts).toHaveLength(0);
  });

  it('returns 400 for a sitting id that is not a uuid', async () => {
    const res = await POST(saveReq({ sittingId: 's1', questionId: Q1, answerValue: 'A' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid sitting id');
    expect(h.state.inserts).toHaveLength(0);
  });

  it('never writes a question id that the uuid column would reject', async () => {
    h.state.sittingRow = openSitting([Q1]);
    h.state.questionRow = { id: Q1, roundId: 'round-1', questionType: 'matching' };

    for (const key of [Q1, `${Q1}_0`, `${Q1}_1`, `${Q1}_12`]) {
      const res = await POST(saveReq({ sittingId: SITTING, questionId: key, answerValue: 'x' }));
      expect(res.status).toBe(200);
    }

    const written = h.state.inserts.filter((i) => i.table === studentAnswers);
    expect(written.length).toBe(4);
    for (const insert of written) {
      expect(isUuid(insert.values.questionId)).toBe(true);
      expect(isUuid(insert.values.sittingId)).toBe(true);
    }
  });
});
