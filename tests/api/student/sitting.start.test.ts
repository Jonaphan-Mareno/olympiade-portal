import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/student/sitting/start/route';
import { rounds, memberships, questionPapers, examSittings } from '@/lib/db/schema';

// The start route reads four tables in sequence (round, membership, paper,
// existing sitting) and may insert a paper and/or a sitting. The db mock tells
// the `select()` calls apart by the table passed to `.from()` and records every
// insert so a test can assert on the written values. The chain is thenable at
// every step because some queries are awaited after `.where()` and others after
// `.limit()`. Table identities are injected after import (vi.hoisted runs first).
const h = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    roundRow: null as any,
    membershipRow: null as any,
    paperRow: null as any,
    existingSittingRow: null as any,
    inserts: [] as Array<{ table: any; values: any }>,
    tables: {} as Record<string, any>,
  };

  const rowsFor = (table: any): any[] => {
    if (table === state.tables.rounds) return state.roundRow ? [state.roundRow] : [];
    if (table === state.tables.memberships) return state.membershipRow ? [state.membershipRow] : [];
    if (table === state.tables.questionPapers) return state.paperRow ? [state.paperRow] : [];
    if (table === state.tables.examSittings)
      return state.existingSittingRow ? [state.existingSittingRow] : [];
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
        return {
          returning: () => {
            if (table === state.tables.questionPapers) {
              return Promise.resolve([
                { id: 'paper-auto', roundId: values.roundId, durationMinutes: values.durationMinutes },
              ]);
            }
            if (table === state.tables.examSittings) {
              return Promise.resolve([{ id: 'sitting-new', ...values }]);
            }
            return Promise.resolve([{ id: 'row-new' }]);
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

h.state.tables.rounds = rounds;
h.state.tables.memberships = memberships;
h.state.tables.questionPapers = questionPapers;
h.state.tables.examSittings = examSittings;

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));

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
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.user = { id: 'student-1' };
  h.state.roundRow = null;
  h.state.membershipRow = null;
  h.state.paperRow = null;
  h.state.existingSittingRow = null;
  h.state.inserts = [];
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

  it('auto-creates a question paper with the default 60-minute duration when the round has none', async () => {
    h.state.roundRow = openRound();
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = null; // forces the insert branch

    const res = await POST(startReq({ roundId: 'round-1' }));

    expect(res.status).toBe(200);
    const paperInsert = h.state.inserts.find((i) => i.table === questionPapers);
    expect(paperInsert).toBeTruthy();
    expect(paperInsert!.values).toMatchObject({ roundId: 'round-1', durationMinutes: 60 });
  });

  it('resumes an existing active sitting instead of creating a new one', async () => {
    h.state.roundRow = openRound();
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = { id: 'paper-1', roundId: 'round-1', durationMinutes: 60 };
    h.state.existingSittingRow = { id: 'sitting-active' };

    const res = await POST(startReq({ roundId: 'round-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ sittingId: 'sitting-active', resumed: true });
    // No new sitting row was written.
    expect(h.state.inserts.some((i) => i.table === examSittings)).toBe(false);
  });

  it('starts a new sitting and returns resumed:false when none is active', async () => {
    h.state.roundRow = openRound();
    h.state.membershipRow = { id: 'm1' };
    h.state.paperRow = { id: 'paper-1', roundId: 'round-1', durationMinutes: 90 };
    h.state.existingSittingRow = null;

    const res = await POST(startReq({ roundId: 'round-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ sittingId: 'sitting-new', resumed: false });

    const sittingInsert = h.state.inserts.find((i) => i.table === examSittings);
    expect(sittingInsert).toBeTruthy();
    expect(sittingInsert!.values).toMatchObject({
      studentMembershipId: 'm1',
      questionPaperId: 'paper-1',
      status: 'active',
    });
    expect(sittingInsert!.values.startedAt).toBeInstanceOf(Date);
  });
});
