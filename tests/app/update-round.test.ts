import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateRound } from '@/app/organiser/olympiads/[olympiadId]/rounds/[roundId]/actions';
import { generateTestFromPDF } from '@/app/organiser/olympiads/[olympiadId]/rounds/[roundId]/ai-actions';
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
// applies an id-preserving question upsert (update unchanged ids, insert new
// ones, delete only rows that vanished). The db mock records every write so a
// test can assert on the values, and discriminates the `select()` calls by the
// table passed to `.from()`. A select node is BOTH thenable (updateRound awaits
// `...where()` directly for the existing-questions read) and carries `.limit()`
// (it awaits `...where().limit(1)` for the paper / sittings reads). The table
// identities are injected after import because `vi.hoisted` runs first.
const h = vi.hoisted(() => {
  const state = {
    authUser: null as { id: string } | null,
    paperRows: [] as any[],
    sittingRows: [] as any[],
    questionRows: [] as any[],
    // Round + portal authorization row returned by the authz join
    // (db.select().from(rounds).innerJoin(portals)...). deliveryMethod is the
    // STORED method that keys the live-sitting lock; portalOwnerId gates authz.
    roundRows: [] as any[],
    updates: [] as Array<{ table: any; values: any }>,
    inserts: [] as Array<{ table: any; values: any }>,
    deletes: [] as Array<{ table: any }>,
    revalidated: [] as string[],
    paperTable: null as any,
    sittingTable: null as any,
    questionTable: null as any,
    roundTable: null as any,
  };

  const rowsFor = (table: any) =>
    table === state.paperTable
      ? state.paperRows
      : table === state.sittingTable
        ? state.sittingRows
        : table === state.questionTable
          ? state.questionRows
          : table === state.roundTable
            ? state.roundRows
            : [];

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
      const resolveRows = () => Promise.resolve(rowsFor(captured));
      // Thenable + `.limit()`, so both await styles resolve to the same rows.
      const node = (): any => {
        const p: any = resolveRows();
        p.limit = () => resolveRows();
        return p;
      };
      const chain: any = {
        from: (t: any) => {
          captured = t;
          return chain;
        },
        innerJoin: () => chain,
        where: () => node(),
        limit: () => resolveRows(),
        then: (res: any, rej: any) => resolveRows().then(res, rej),
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
h.state.questionTable = questions;
h.state.roundTable = rounds;

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
const updatesFor = (table: any) => h.state.updates.filter((u) => u.table === table);
const insertFor = (table: any) => h.state.inserts.find((i) => i.table === table);
const insertsFor = (table: any) => h.state.inserts.filter((i) => i.table === table);
const deletesFor = (table: any) => h.state.deletes.filter((d) => d.table === table);

// Valid UUIDs so questionDbId() reuses them as row ids (keeps the id-preserving
// upsert and the physical selection lined up 1:1 with the written rows).
const UUID1 = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const UUID3 = '33333333-3333-4333-8333-333333333333';

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

// An online-ready question: integer marks + difficulty 1-5, which is what the
// publish guard requires before an online/hybrid round may be written.
const readyMcq = (over: Record<string, any> = {}) =>
  mcq({ id: UUID1, marks: '10', difficulty: '1', ...over });

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

// update keeps an existing paper PDF, so a hybrid form needs no file here.
const hybridForm = (qs: any[], fields: Record<string, string> = {}) =>
  buildForm({
    deliveryMethod: 'hybrid',
    questionsData: JSON.stringify(qs),
    ...fields,
  });

// A pure-paper submission (used to prove the live-sitting lock keys on the
// STORED delivery method, not this submitted field).
const paperForm = (qs: any[] = [], fields: Record<string, string> = {}) =>
  buildForm({
    deliveryMethod: 'paper',
    questionsData: JSON.stringify(qs),
    ...fields,
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.state.authUser = { id: 'organiser-1' };
  // An existing paper row sends updateRound down the "update" path.
  h.state.paperRows = [{ id: 'paper-1', fileUrl: null, answerKeyJson: null }];
  h.state.sittingRows = [];
  // No pre-existing questions by default => every payload row is an insert.
  h.state.questionRows = [];
  // The stored round is owned by the signed-in organiser and (by default) is an
  // online round, so the live-sitting lock keys on the STORED delivery method.
  h.state.roundRows = [
    {
      id: 'round-1',
      portalId: 'portal-1',
      deliveryMethod: 'online',
      portalOwnerId: 'organiser-1',
    },
  ];
  h.state.updates = [];
  h.state.inserts = [];
  h.state.deletes = [];
  h.state.revalidated = [];
});

describe('updateRound', () => {
  it('derives the time limit from the open->close window and ignores any submitted durationMinutes', async () => {
    // The create/edit form no longer renders the field; even if a stale value is
    // posted, the stored limit must come from the 2-day window (2880 min).
    await updateRound(
      onlineForm([readyMcq()], { durationMinutes: '30', targetTotalMarks: '10' })
    );

    expect(updateFor(questionPapers)?.values).toMatchObject({ durationMinutes: 2880 });
    expect(redirect).toHaveBeenCalledWith('/organiser/olympiads/portal-1');
    expect(h.state.revalidated).toContain('/organiser/olympiads/portal-1');
  });

  it('derives a partial-day window (09:00 -> 11:30 = 150 min)', async () => {
    await updateRound(
      onlineForm([readyMcq()], {
        opensAt: '2026-10-01T09:00',
        closesAt: '2026-10-01T11:30',
        targetTotalMarks: '10',
      })
    );

    expect(updateFor(questionPapers)?.values).toMatchObject({ durationMinutes: 150 });
  });

  it('persists the derived limit when the round has no question paper yet (insert path)', async () => {
    h.state.paperRows = [];

    await updateRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }));

    expect(insertFor(questionPapers)?.values).toMatchObject({
      roundId: 'round-1',
      durationMinutes: 2880,
    });
  });

  it('persists the unified target total marks on the round', async () => {
    await updateRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }));

    expect(updateFor(rounds)?.values).toMatchObject({ targetTotalMarks: 10 });
  });

  // --- id-preserving question upsert ---------------------------------------

  it('updates existing questions in place and never blanket-deletes when ids are unchanged', async () => {
    // Both payload ids already exist as rows.
    h.state.questionRows = [{ id: UUID1 }, { id: UUID2 }];

    await updateRound(
      onlineForm(
        [
          readyMcq({ id: UUID1, marks: '5', difficulty: '1', prompt: 'Q1 updated' }),
          readyMcq({
            id: UUID2,
            marks: '5',
            difficulty: '2',
            prompt: 'Q2',
            options: ['a', 'b'],
            correctAnswer: 'a',
          }),
        ],
        { targetTotalMarks: '10' }
      )
    );

    // Two in-place updates, no insert, and crucially no delete of the rows that
    // a persisted selectedQuestionIds / dealt variant still points at.
    expect(updatesFor(questions)).toHaveLength(2);
    expect(insertsFor(questions)).toHaveLength(0);
    expect(deletesFor(questions)).toHaveLength(0);
    // The id is the WHERE key, so it is stripped from the SET payload.
    expect(updatesFor(questions)[0].values.id).toBeUndefined();
    expect(updatesFor(questions)[0].values.prompt).toBe('Q1 updated');
  });

  it('inserts new questions and deletes only the rows that vanished from the payload', async () => {
    // UUID1 is kept; UUID3 is stale (no longer submitted) and must be removed.
    h.state.questionRows = [{ id: UUID1 }, { id: UUID3 }];

    await updateRound(
      onlineForm(
        [
          readyMcq({ id: UUID1, marks: '10', difficulty: '1' }),
          readyMcq({
            id: UUID2,
            marks: '5',
            difficulty: '2',
            prompt: 'Brand new question',
            options: ['a', 'b'],
            correctAnswer: 'a',
          }),
        ],
        { targetTotalMarks: '15' }
      )
    );

    // UUID1 updated in place; UUID2 inserted alone (not the whole pool).
    expect(updatesFor(questions)).toHaveLength(1);
    const qInserts = insertsFor(questions);
    expect(qInserts).toHaveLength(1);
    expect(qInserts[0].values).toHaveLength(1);
    expect(qInserts[0].values[0].id).toBe(UUID2);
    // Only the vanished row is deleted.
    expect(deletesFor(questions)).toHaveLength(1);
  });

  it('persists difficulty and the ordered physical selection for a hybrid round', async () => {
    await updateRound(
      hybridForm(
        [
          readyMcq({ id: UUID1, marks: '5', difficulty: '3' }),
          readyMcq({
            id: UUID2,
            marks: '5',
            difficulty: '4',
            prompt: 'Q2',
            options: ['a', 'b'],
            correctAnswer: 'a',
          }),
        ],
        {
          targetTotalMarks: '10',
          selectedQuestionIds: JSON.stringify([UUID2, UUID1]),
        }
      )
    );

    expect(updateFor(rounds)?.values).toMatchObject({ targetTotalMarks: 10 });
    // Order is preserved exactly as the organiser arranged it.
    expect(updateFor(questionPapers)?.values.selectedQuestionIds).toEqual([
      UUID2,
      UUID1,
    ]);
    expect(insertFor(questions)!.values.map((q: any) => q.difficulty)).toEqual([3, 4]);
  });

  // --- publish-readiness guard (server-authoritative) ----------------------

  it('blocks the update when an online question is missing its marks', async () => {
    await expect(
      updateRound(onlineForm([readyMcq({ marks: '' })], { targetTotalMarks: '10' }))
    ).rejects.toThrow(/not ready to publish/);

    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
    expect(h.state.deletes).toHaveLength(0);
  });

  it('blocks the update when an online question is missing its difficulty', async () => {
    await expect(
      updateRound(
        onlineForm([readyMcq({ difficulty: '' })], { targetTotalMarks: '10' })
      )
    ).rejects.toThrow(/not ready to publish/);

    expect(h.state.updates).toHaveLength(0);
  });

  it('blocks the update when the target total is unreachable', async () => {
    // Two 5-mark questions can only total 0, 5 or 10 — never 7.
    await expect(
      updateRound(
        onlineForm(
          [
            readyMcq({ id: UUID1, marks: '5', difficulty: '1' }),
            readyMcq({
              id: UUID2,
              marks: '5',
              difficulty: '2',
              prompt: 'Q2',
              options: ['a', 'b'],
              correctAnswer: 'a',
            }),
          ],
          { targetTotalMarks: '7' }
        )
      )
    ).rejects.toThrow(/not ready to publish/);

    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
  });

  // --- live-sitting edit lock ----------------------------------------------

  it('refuses to edit a round that already has live sittings, noting dealt variants are frozen', async () => {
    h.state.sittingRows = [{ id: 'sitting-1' }];

    await expect(
      updateRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }))
    ).rejects.toThrow(/already begun their attempts/);

    // The lock fires before any write.
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
    expect(h.state.deletes).toHaveLength(0);
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

  // --- round + portal authorization (Ryan #4) ------------------------------
  // Neither the [olympiadId] URL segment nor the submitted roundId/portalId are
  // trusted. updateRound joins portals on rounds.portalId, matches BOTH ids and
  // enforces portal ownership BEFORE any write, so a student / non-owner can
  // never rewrite someone else's round (flip the target, delete the pool, ...).

  it('rejects a caller who does not own the round portal (non-owner/student)', async () => {
    h.state.authUser = { id: 'student-1' }; // signed in, but not the owner

    await expect(
      updateRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }))
    ).rejects.toThrow('Not authorized');

    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
    expect(h.state.deletes).toHaveLength(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('rejects when the round/portal cannot be resolved (id mismatch or missing)', async () => {
    // The authz join returns nothing => the round does not belong to the portal.
    h.state.roundRows = [];

    await expect(
      updateRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }))
    ).rejects.toThrow('Not authorized');

    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
    expect(h.state.deletes).toHaveLength(0);
  });

  // --- live-sitting lock keyed on the STORED delivery method (Ryan #4) ------

  it('locks a live ONLINE round even when the attacker submits deliveryMethod:"paper"', async () => {
    // Stored round is online with a sitting already begun; the submitted form
    // claims "paper" to try to slip past the lock. The lock must use the STORED
    // method, so it still fires before any write.
    h.state.roundRows = [
      {
        id: 'round-1',
        portalId: 'portal-1',
        deliveryMethod: 'online',
        portalOwnerId: 'organiser-1',
      },
    ];
    h.state.sittingRows = [{ id: 'sitting-1' }];

    await expect(
      updateRound(paperForm([mcq({ id: UUID1, marks: '5' })]))
    ).rejects.toThrow(/already begun their attempts/);

    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
    expect(h.state.deletes).toHaveLength(0);
  });

  it('does not apply the online lock when the STORED round is paper', async () => {
    // Stored round is paper (no online sittings to protect); even though a
    // sitting row exists and the form claims "online", the stored method governs.
    h.state.roundRows = [
      {
        id: 'round-1',
        portalId: 'portal-1',
        deliveryMethod: 'paper',
        portalOwnerId: 'organiser-1',
      },
    ];
    h.state.sittingRows = [{ id: 'sitting-1' }];

    await updateRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }));

    expect(updateFor(rounds)).toBeDefined();
    expect(redirect).toHaveBeenCalledWith('/organiser/olympiads/portal-1');
  });

  // --- legacy backward-compat exemption (Daniel H1) -------------------------

  it('lets a LEGACY round (null target + all-null difficulty) be updated without tripping the guard', async () => {
    // No targetTotalMarks submitted and no question carries a difficulty, so the
    // readiness guard is skipped: an organiser can fix a typo / adjust the
    // window on a pre-existing round without retrofitting the whole pool.
    await updateRound(
      onlineForm([mcq({ id: UUID1, prompt: 'Typo fixed' })]) // marks '' , no difficulty
    );

    expect(updateFor(rounds)).toBeDefined();
    expect(updateFor(rounds)?.values.targetTotalMarks).toBeNull();
    expect(redirect).toHaveBeenCalledWith('/organiser/olympiads/portal-1');
  });

  it('still guards a round WITH a target when a used question lacks marks', async () => {
    // A difficulty/target has been set, so the round is NOT legacy and must be
    // guarded authoritatively before the write.
    await expect(
      updateRound(
        onlineForm(
          [
            readyMcq({ id: UUID1, marks: '5', difficulty: '1' }),
            readyMcq({
              id: UUID2,
              marks: '', // missing marks on a used question
              difficulty: '2',
              prompt: 'Q2',
              options: ['a', 'b'],
              correctAnswer: 'a',
            }),
          ],
          { targetTotalMarks: '5' }
        )
      )
    ).rejects.toThrow(/not ready to publish/);

    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
  });

  it('still guards a round WITH difficulty set even when no target is submitted', async () => {
    // Any difficulty set => not legacy => the online checker runs and, with no
    // positive target, blocks the publish.
    await expect(
      updateRound(onlineForm([readyMcq({ id: UUID1, marks: '5', difficulty: '2' })]))
    ).rejects.toThrow(/not ready to publish/);

    expect(h.state.updates).toHaveLength(0);
  });
});

// --- edit-page AI generator (Mark Medium) ----------------------------------
// generateTestFromPDF persists a DRAFT pool: difficulty null (never guessed by
// the AI) and nullable marks ('' / null -> null, NOT `|| 1`). It also refuses
// to blanket-delete a pool that students are actively sitting.
describe('generateTestFromPDF (edit-page AI action)', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  let geminiQuestions: any[] = [];

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    // A paper PDF must exist for the round; no sittings by default.
    h.state.paperRows = [
      { id: 'paper-1', fileUrl: 'https://cdn.test/paper.pdf', answerKeyJson: null },
    ];
    h.state.sittingRows = [];
    h.state.questionRows = [];
    geminiQuestions = [];

    // Mock the two outbound fetches: the PDF download and the Gemini call.
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          json: async () => ({
            candidates: [
              { content: { parts: [{ text: JSON.stringify(geminiQuestions) }] } },
            ],
          }),
        };
      }
      // PDF fetch -> arrayBuffer()
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    });
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('defaults difficulty to null and keeps marks nullable (never coerces to 1)', async () => {
    geminiQuestions = [
      { questionText: 'Q with marks', type: 'text', options: [], marks: 5, correctAnswer: '' },
      { questionText: 'Q null marks', type: 'text', options: [], marks: null, correctAnswer: '' },
      { questionText: 'Q blank marks', type: 'text', options: [], marks: '', correctAnswer: '' },
    ];

    await generateTestFromPDF('round-1', 'portal-1');

    const saved = insertFor(questions)!.values;
    expect(saved).toHaveLength(3);
    // marks: 5 stays 5; null and '' both become null (NOT 1).
    expect(saved[0].marks).toBe(5);
    expect(saved[1].marks).toBeNull();
    expect(saved[2].marks).toBeNull();
    // The AI never guesses difficulty.
    expect(saved.every((q: any) => q.difficulty === null)).toBe(true);
  });

  it('refuses to regenerate (and never blanket-deletes) once students have begun', async () => {
    geminiQuestions = [
      { questionText: 'Q', type: 'text', options: [], marks: 5, correctAnswer: '' },
    ];
    h.state.sittingRows = [{ id: 'sitting-1' }];

    await expect(
      generateTestFromPDF('round-1', 'portal-1')
    ).rejects.toThrow(/frozen|begun their attempts/);

    // No delete-all-reinsert orphaning: nothing was deleted or inserted.
    expect(deletesFor(questions)).toHaveLength(0);
    expect(insertsFor(questions)).toHaveLength(0);
  });
});
