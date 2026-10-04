import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateRound } from '@/app/organiser/olympiads/[olympiadId]/rounds/[roundId]/actions';
import { rounds, questionPapers, questions, examSittings } from '@/lib/db/schema';
import { redirect } from 'next/navigation';

// updateRound names any replacement storage object with crypto.randomUUID().
// jsdom does not always implement it, so fall back to a deterministic stub.
const g = globalThis as any;
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.randomUUID !== 'function') {
  g.crypto.randomUUID = () => 'fixed-uuid';
}

// The edit action updates the round, then upserts its question_papers row and
// re-writes its questions. The db mock below records every write so a test can
// assert on the values, and discriminates the two `select()` calls (question
// papers vs. exam sittings) by the table passed to `.from()`. The table
// identities are injected after import because `vi.hoisted` runs first.
const h = vi.hoisted(() => {
  const state = {
    authUser: null as { id: string } | null,
    paperRows: [] as any[],
    sittingRows: [] as any[],
    updates: [] as Array<{ table: any; values: any }>,
    inserts: [] as Array<{ table: any; values: any }>,
    deletes: [] as Array<{ table: any }>,
    revalidated: [] as string[],
    paperTable: null as any,
    sittingTable: null as any,
  };

  const db = {
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
        return Promise.resolve();
      },
    }),
    delete: (table: any) => ({
      where: () => {
        state.deletes.push({ table });
        return Promise.resolve();
      },
    }),
    select: () => {
      let captured: any = null;
      const chain: any = {
        from: (t: any) => {
          captured = t;
          return chain;
        },
        where: () => chain,
        limit: () => {
          const rows =
            captured === state.paperTable
              ? state.paperRows
              : captured === state.sittingTable
                ? state.sittingRows
                : [];
          return Promise.resolve(rows);
        },
      };
      return chain;
    },
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.authUser } }) },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.test/x' } }),
      }),
    },
  };

  return { state, db, supabase };
});

// Inject the real table identities now that the schema import has evaluated.
h.state.paperTable = questionPapers;
h.state.sittingTable = examSittings;

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    h.state.revalidated.push(path);
  },
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
// The action module also imports these for deleteRound / publishRoundResults.
// updateRound never calls them, but mocking keeps the import side-effect free.
vi.mock('@/domain/notifications/in-app-notifications', () => ({
  notifyEducatorsInPortal: vi.fn(async () => {}),
}));
vi.mock('@/domain/notifications/automation-rules', () => ({
  loadActiveRules: vi.fn(async () => new Map()),
  runDueRules: vi.fn(async () => ({ triggered: [], summary: { sent: 0, skipped: 0, failed: 0 } })),
}));
vi.mock('@/domain/rounds/advance-entrants', () => ({
  advanceQualifyingEntrants: vi.fn(async () => null),
}));

// --- helpers ---------------------------------------------------------------

const updateFor = (table: any) => h.state.updates.find((u) => u.table === table);
const insertFor = (table: any) => h.state.inserts.find((i) => i.table === table);

// A single-choice question that satisfies updateRound's validation. `marks`
// defaults to '' to mirror exactly what QuestionBuilder submits.
const mcq = (over: Record<string, any> = {}) => ({
  id: 'q1',
  type: 'single_choice',
  prompt: 'What is 2 + 2?',
  marks: '',
  options: ['4', '5'],
  correctAnswer: '4',
  ...over,
});

function buildForm(
  fields: Record<string, string>,
  files: Record<string, File> = {}
) {
  const fd = new FormData();
  fd.append('portalId', 'portal-1');
  fd.append('roundId', 'round-1');
  fd.append('name', 'Round One');
  fd.append('orderIndex', '1');
  // Default window is exactly 2 days = 2880 minutes.
  fd.append('opensAt', '2026-10-01T09:00');
  fd.append('closesAt', '2026-10-03T09:00');
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const [k, file] of Object.entries(files)) fd.set(k, file);
  return fd;
}

const onlineForm = (qs: any[], fields: Record<string, string> = {}) =>
  buildForm({
    deliveryMethod: 'online',
    questionsData: JSON.stringify(qs),
    ...fields,
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.state.authUser = { id: 'organiser-1' };
  // An existing paper row sends updateRound down the "update" path.
  h.state.paperRows = [{ id: 'paper-1', fileUrl: null, answerKeyJson: null }];
  h.state.sittingRows = [];
  h.state.updates = [];
  h.state.inserts = [];
  h.state.deletes = [];
  h.state.revalidated = [];
});

describe('updateRound', () => {
  it('derives the time limit from the open->close window and ignores any submitted durationMinutes', async () => {
    // The create/edit form no longer renders the field; even if a stale value is
    // posted, the stored limit must come from the 2-day window (2880 min).
    await updateRound(onlineForm([mcq()], { durationMinutes: '30' }));

    expect(updateFor(questionPapers)?.values).toMatchObject({ durationMinutes: 2880 });
    expect(redirect).toHaveBeenCalledWith('/organiser/olympiads/portal-1');
    expect(h.state.revalidated).toContain('/organiser/olympiads/portal-1');
  });

  it('derives a partial-day window (09:00 -> 11:30 = 150 min)', async () => {
    await updateRound(
      onlineForm([mcq()], {
        opensAt: '2026-10-01T09:00',
        closesAt: '2026-10-01T11:30',
      })
    );

    expect(updateFor(questionPapers)?.values).toMatchObject({ durationMinutes: 150 });
  });

  it('persists the derived limit when the round has no question paper yet (insert path)', async () => {
    h.state.paperRows = [];

    await updateRound(onlineForm([mcq()]));

    expect(insertFor(questionPapers)?.values).toMatchObject({
      roundId: 'round-1',
      durationMinutes: 2880,
    });
  });

  it('rejects a closing time that is not after the opening time', async () => {
    await expect(
      updateRound(
        onlineForm([mcq()], {
          opensAt: '2026-10-05T09:00',
          closesAt: '2026-10-01T09:00',
        })
      )
    ).rejects.toThrow(/Closing time must be after/);

    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
  });

  it('requires a signed-in organiser', async () => {
    h.state.authUser = null;

    await expect(updateRound(onlineForm([mcq()]))).rejects.toThrow('Unauthorized');

    expect(h.state.updates).toHaveLength(0);
  });
});
