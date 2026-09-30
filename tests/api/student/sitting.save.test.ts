import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/student/sitting/save/route';
import { examSittings, questions, studentAnswers } from '@/lib/db/schema';

// The save route reads the sitting (joined to its paper and round), enforces the
// attempt deadline, then upserts the answer. The db mock discriminates the two
// `select()` calls by the table passed to `.from()` — the identities are injected
// after import because `vi.hoisted` runs first.
const h = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    sittingRow: null as any,
    questionRow: null as any,
    updates: [] as Array<{ table: any; values: any }>,
    inserts: [] as Array<{ table: any; values: any }>,
    sittingsTable: null as any,
    questionsTable: null as any,
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
        return { onConflictDoUpdate: () => Promise.resolve() };
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

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));

// --- helpers ---------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function saveReq(body: Record<string, any>) {
  return new Request('http://localhost:3000/api/student/sitting/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Builds a sitting row relative to the real clock so no fake timers are needed.
function sittingRow({
  startedAgoMs,
  durationMinutes,
  closesInMs,
  status = 'active',
}: {
  startedAgoMs: number;
  durationMinutes: number;
  closesInMs: number;
  status?: string;
}) {
  const now = Date.now();
  return {
    sitting: { id: 's1', status, startedAt: new Date(now - startedAgoMs) },
    membership: { id: 'm1' },
    paper: { durationMinutes, roundId: 'round-1' },
    round: { closesAt: new Date(now + closesInMs) },
  };
}

const payload = { sittingId: 's1', questionId: 'q1', answerValue: 'A' };

beforeEach(() => {
  vi.clearAllMocks();
  h.state.user = { id: 'student-1' };
  h.state.sittingRow = null;
  h.state.questionRow = { id: 'q1', roundId: 'round-1' };
  h.state.updates = [];
  h.state.inserts = [];
});

describe('POST /api/student/sitting/save', () => {
  it('returns 401 when the student is not authenticated', async () => {
    h.state.user = null;

    const res = await POST(saveReq(payload));

    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(saveReq({ sittingId: 's1' }));

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
    // Started 10 min ago with a 120-min limit and a far-off close -> ~110 min left.
    h.state.sittingRow = sittingRow({
      startedAgoMs: 10 * MIN,
      durationMinutes: 120,
      closesInMs: 3 * DAY,
    });

    const res = await POST(saveReq(payload));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(h.state.inserts.some((i) => i.table === studentAnswers)).toBe(true);
  });

  it('rejects a question that does not belong to this test', async () => {
    h.state.sittingRow = sittingRow({
      startedAgoMs: 10 * MIN,
      durationMinutes: 120,
      closesInMs: 3 * DAY,
    });
    h.state.questionRow = { id: 'q1', roundId: 'some-other-round' };

    const res = await POST(saveReq(payload));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Question does not belong to this test');
    expect(h.state.inserts).toHaveLength(0);
  });
});
