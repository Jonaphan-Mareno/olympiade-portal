import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/student/sitting/start/route';
import { rounds, memberships, questionPapers, examSittings, questions } from '@/lib/db/schema';

// The start route now runs inside a single db.transaction: it loads the round,
// membership and paper (find-or-create), returns an already-active sitting
// WITHOUT redrawing, and otherwise deals a difficulty-balanced variant from the
// pool and inserts the sitting with ON CONFLICT DO NOTHING RETURNING id (so a
// concurrent winner is resumed instead of duplicated).
//
// The db mock tells `select()` calls apart by the table passed to `.from()` and
// records every insert. The exam-sitting select can be driven by a per-call
// queue so the resume-first check and the post-conflict re-select can return
// different rows. Table identities are injected after import (vi.hoisted first).
const h = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    roundRow: null as any,
    membershipRow: null as any,
    paperRow: null as any,
    existingSittingRow: null as any,
    // When set, each examSittings select shifts one result array off this queue
    // (used to model "no active sitting, then a concurrent winner appears").
    sittingSelectQueue: null as null | any[][],
    // When set, overrides what the sitting INSERT … RETURNING yields ([] models
    // an ON CONFLICT DO NOTHING that lost the race).
    sittingInsertReturning: undefined as undefined | any[],
    poolRows: [] as any[],
    inserts: [] as Array<{ table: any; values: any }>,
    selectCounts: { questions: 0 },
    tables: {} as Record<string, any>,
  };

  const rowsFor = (table: any): any[] => {
    if (table === state.tables.rounds) return state.roundRow ? [state.roundRow] : [];
    if (table === state.tables.memberships) return state.membershipRow ? [state.membershipRow] : [];
    if (table === state.tables.questionPapers) {
      // The route always attempts the ON CONFLICT insert then re-selects, so a
      // round with no paper still resolves to the freshly-created default row.
      return state.paperRow
        ? [state.paperRow]
        : [{ id: 'paper-auto', roundId: 'round-1', durationMinutes: 60 }];
    }
    if (table === state.tables.questions) {
      state.selectCounts.questions += 1;
      return state.poolRows;
    }
    if (table === state.tables.examSittings) {
      if (state.sittingSelectQueue) return state.sittingSelectQueue.shift() ?? [];
      return state.existingSittingRow ? [state.existingSittingRow] : [];
    }
    return [];
  };

  const makeSelect = () => (_fields?: any) => {
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
  };

  const makeInsert = () => (table: any) => ({
    values: (values: any) => {
      state.inserts.push({ table, values });
      const returned = () => {
        if (table === state.tables.examSittings) {
          return state.sittingInsertReturning !== undefined
            ? state.sittingInsertReturning
            : [{ id: 'sitting-new', ...values }];
        }
        if (table === state.tables.questionPapers) {
          return [{ id: 'paper-auto', roundId: values.roundId, durationMinutes: values.durationMinutes }];
        }
        return [{ id: 'row-new', ...values }];
      };
      const conflict: any = {
        // Awaitable (paper path) and chainable to .returning() (sitting path).
        then: (res: any, rej: any) => Promise.resolve().then(res, rej),
        returning: (_f?: any) => Promise.resolve(returned()),
      };
      const chain: any = {
        returning: (_f?: any) => Promise.resolve(returned()),
        onConflictDoNothing: () => conflict,
        onConflictDoUpdate: () => conflict,
        then: (res: any, rej: any) => Promise.resolve(returned()).then(res, rej),
      };
      return chain;
    },
  });

  // `tx` shares the same behaviour as the top-level db, so the transaction
  // callback can select/insert exactly as the route expects.
  const db: any = {
    select: makeSelect(),
    insert: makeInsert(),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  };

  return { state, db, supabase };
});

h.state.tables.rounds = rounds;
h.state.tables.memberships = memberships;
h.state.tables.questionPapers = questionPapers;
h.state.tables.examSittings = examSittings;
h.state.tables.questions = questions;

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));

// A controllable seam over the real variant generator so the re-draw safety net
// can be exercised deterministically. When `drawCtl.impl` is null the real
// `drawVariant` is used (all pre-existing tests keep their real behaviour).
const drawCtl = vi.hoisted(() => ({
  impl: null as null | ((...args: any[]) => any),
  calls: 0,
}));

vi.mock('@/domain/question-bank/variant-generator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/question-bank/variant-generator')>();
  return {
    ...actual,
    drawVariant: (...args: any[]) => {
      drawCtl.calls += 1;
      return drawCtl.impl ? drawCtl.impl(...args) : actual.drawVariant(args[0], args[1]);
    },
  };
});

// --- helpers ---------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function startReq(body: Record<string, any>) {
  return new Request('http://localhost:3000/api/student/sitting/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// An online round for portal p1 that is open right now.
function openRound(over: Record<string, any> = {}) {
  const now = Date.now();
  return {
    id: 'round-1',
    portalId: 'p1',
    deliveryMethod: 'online',
    opensAt: new Date(now - HOUR),
    closesAt: new Date(now + DAY),
    targetTotalMarks: null,
    ...over,
  };
}

// A three-question pool that exactly fills a 6-mark target (2 marks each).
const balancedPool = [
  { id: 'q1', marks: 2, difficulty: 1 },
  { id: 'q2', marks: 2, difficulty: 2 },
  { id: 'q3', marks: 2, difficulty: 3 },
];

const sittingInsert = () => h.state.inserts.find((i) => i.table === examSittings);

beforeEach(() => {
  vi.clearAllMocks();
  h.state.user = { id: 'student-1' };
  h.state.roundRow = null;
  h.state.membershipRow = null;
  h.state.paperRow = null;
  h.state.existingSittingRow = null;
  h.state.sittingSelectQueue = null;
  h.state.sittingInsertReturning = undefined;
  h.state.poolRows = [];
  h.state.inserts = [];
  h.state.selectCounts.questions = 0;
  drawCtl.impl = null;
  drawCtl.calls = 0;
});

describe('POST /api/student/sitting/start', () => {
  it('returns 401 when the student is not authenticated', async () => {
    h.state.user = null;

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 when roundId is missing', async () => {
    const res = await POST(startReq({}));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Missing roundId');
  });

  it('returns 404 when the round does not exist', async () => {
    h.state.roundRow = null;

    const res = await POST(startReq({ roundId: 'nope' }));

    expect(res.status).toBe(404);
  });

  it('returns 403 when the student is not an accepted member of the round portal', async () => {
    h.state.roundRow = openRound();
    h.state.membershipRow = null;

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('You are not enrolled in this olympiad');
  });

  it('returns 400 when the round is not an online test', async () => {
    h.state.roundRow = openRound({ deliveryMethod: 'paper' });
    h.state.membershipRow = { id: 'm1' };

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('This round is not an online test');
  });

  it('returns 400 when the round has not opened yet', async () => {
    const now = Date.now();
    h.state.roundRow = openRound({
      opensAt: new Date(now + HOUR),
      closesAt: new Date(now + DAY),
    });
    h.state.membershipRow = { id: 'm1' };

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('This test has not opened yet');
  });

  it('returns 400 when the round has already closed', async () => {
    const now = Date.now();
    h.state.roundRow = openRound({
      opensAt: new Date(now - DAY),
      closesAt: new Date(now - HOUR),
    });
    h.state.membershipRow = { id: 'm1' };

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('This test is closed');
  });

  it('find-or-creates the question paper with the default 60-minute duration', async () => {
    h.state.roundRow = openRound();
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = null; // no paper yet -> the ON CONFLICT insert branch
    h.state.poolRows = balancedPool;

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(200);
    const paperInsert = h.state.inserts.find((i) => i.table === questionPapers);
    expect(paperInsert).toBeTruthy();
    expect(paperInsert!.values).toMatchObject({ roundId: 'round-1', durationMinutes: 60 });
  });

  it('resumes an existing active sitting WITHOUT dealing a new variant', async () => {
    h.state.roundRow = openRound();
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = { id: 'paper-1', roundId: 'round-1', durationMinutes: 60 };
    h.state.existingSittingRow = { id: 'sitting-active', variantQuestionIds: ['q1'] };
    h.state.poolRows = balancedPool;

    const res = await POST(startReq({ roundId: 'round-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ sittingId: 'sitting-active', resumed: true });
    // No new sitting row was written and the pool was never loaded (no redraw).
    expect(sittingInsert()).toBeUndefined();
    expect(h.state.selectCounts.questions).toBe(0);
  });

  it('deals and persists a variant when a new sitting is created', async () => {
    h.state.roundRow = openRound({ targetTotalMarks: 6 });
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = { id: 'paper-1', roundId: 'round-1', durationMinutes: 90 };
    h.state.existingSittingRow = null;
    h.state.poolRows = balancedPool;

    const res = await POST(startReq({ roundId: 'round-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ sittingId: 'sitting-new', resumed: false });

    const insert = sittingInsert();
    expect(insert).toBeTruthy();
    expect(insert!.values).toMatchObject({
      studentMembershipId: 'm1',
      questionPaperId: 'paper-1',
      status: 'active',
    });
    expect(insert!.values.startedAt).toBeInstanceOf(Date);
    // The whole 6-mark pool fills the 6-mark target exactly.
    expect([...insert!.values.variantQuestionIds].sort()).toEqual(['q1', 'q2', 'q3']);
    // A stable seed string is persisted for the option shuffle.
    expect(typeof insert!.values.variantSeed).toBe('string');
    expect(insert!.values.variantSeed.length).toBeGreaterThan(0);
  });

  it('defaults the target to the pool mark sum when targetTotalMarks is null', async () => {
    h.state.roundRow = openRound({ targetTotalMarks: null });
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = { id: 'paper-1', roundId: 'round-1', durationMinutes: 60 };
    h.state.poolRows = balancedPool; // sums to 6

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(200);
    // Target = 6 (the pool sum) -> the full pool is dealt.
    expect([...sittingInsert()!.values.variantQuestionIds].sort()).toEqual(['q1', 'q2', 'q3']);
  });

  it('resumes the winner when a concurrent request claimed the active sitting (ON CONFLICT DO NOTHING)', async () => {
    h.state.roundRow = openRound({ targetTotalMarks: 6 });
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = { id: 'paper-1', roundId: 'round-1', durationMinutes: 60 };
    // First active-sitting check: none. Post-conflict re-select: the winner.
    h.state.sittingSelectQueue = [[], [{ id: 'sitting-winner' }]];
    h.state.sittingInsertReturning = []; // the insert lost the race
    h.state.poolRows = balancedPool;

    const res = await POST(startReq({ roundId: 'round-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ sittingId: 'sitting-winner', resumed: true });
  });

  it('still deals the variant but logs a structured warning when the target is unreachable (shortfall > 0)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.state.roundRow = openRound({ targetTotalMarks: 10 });
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = { id: 'paper-1', roundId: 'round-1', durationMinutes: 60 };
    h.state.poolRows = [{ id: 'q1', marks: 2, difficulty: 1 }]; // can only reach 2 of 10

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(200);
    // The variant is still dealt despite the shortfall.
    expect(sittingInsert()!.values.variantQuestionIds).toEqual(['q1']);
    // A structured warning was logged with the round/target context.
    expect(errSpy).toHaveBeenCalled();
    const [msg, ctx] = errSpy.mock.calls[0] as [string, any];
    expect(msg).toContain('[sitting/start]');
    expect(ctx).toMatchObject({ roundId: 'round-1', target: 10, totalMarks: 2, shortfall: 8 });
    errSpy.mockRestore();
  });

  it('re-draws with a fresh seed when the first deal falls short, and does NOT log once a re-draw is exact', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.state.roundRow = openRound({ targetTotalMarks: 6 });
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = { id: 'paper-1', roundId: 'round-1', durationMinutes: 60 };
    h.state.poolRows = balancedPool;

    // First deal falls short; the re-draw hits the target exactly.
    let n = 0;
    drawCtl.impl = () => {
      n += 1;
      return n === 1
        ? { questionIds: ['q1'], totalMarks: 2, shortfall: 4, byDifficulty: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 } }
        : { questionIds: ['q1', 'q2', 'q3'], totalMarks: 6, shortfall: 0, byDifficulty: { 1: 1, 2: 1, 3: 1, 4: 0, 5: 0 } };
    };

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(200);
    // The exact re-draw was persisted, and no shortfall warning was logged.
    expect([...sittingInsert()!.values.variantQuestionIds].sort()).toEqual(['q1', 'q2', 'q3']);
    expect(errSpy).not.toHaveBeenCalled();
    expect(drawCtl.calls).toBe(2); // drew once, re-drew once
    errSpy.mockRestore();
  });

  it('gives up after 5 re-draws and logs a single structured warning for a genuinely unreachable pool', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.state.roundRow = openRound({ targetTotalMarks: 10 });
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = { id: 'paper-1', roundId: 'round-1', durationMinutes: 60 };
    h.state.poolRows = [{ id: 'q1', marks: 2, difficulty: 1 }];

    // Every deal falls short (unreachable target).
    drawCtl.impl = () => ({
      questionIds: ['q1'],
      totalMarks: 2,
      shortfall: 8,
      byDifficulty: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 },
    });

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(200);
    expect(drawCtl.calls).toBe(6); // 1 initial + 5 re-draws
    expect(errSpy).toHaveBeenCalledTimes(1); // logged once, not per attempt
    expect(sittingInsert()!.values.variantQuestionIds).toEqual(['q1']);
    errSpy.mockRestore();
  });
});
