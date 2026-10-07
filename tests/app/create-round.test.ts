import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRound } from '@/app/organiser/olympiads/[olympiadId]/rounds/create/actions';
import { rounds, questionPapers, questions } from '@/lib/db/schema';
import { redirect } from 'next/navigation';

// createRound names every storage object with crypto.randomUUID(). jsdom does
// not always implement it, so fall back to a deterministic stub.
const g = globalThis as any;
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.randomUUID !== 'function') {
  g.crypto.randomUUID = () => 'fixed-uuid';
}

// The action uploads to Supabase Storage first, then writes the round, its
// question paper and its questions inside a single db.transaction. The mock
// below emulates that transaction: inserts are buffered and only "committed"
// (pushed to state.txInserts) when the callback resolves, so a mid-transaction
// failure leaves nothing behind — exactly the guarantee the real DB gives and
// the behaviour that stops a half-created (orphaned) round.
const h = vi.hoisted(() => {
  const state = {
    authUser: null as { id: string } | null,
    txInserts: [] as Array<{ table: any; values: any }>,
    uploads: [] as Array<{ bucket: string; path: string }>,
    uploadError: null as { message: string } | null,
    failInsertTable: null as any,
    revalidated: [] as string[],
    roundId: 'round-1',
    // Portal authorization row returned by db.select().from(portals). Default:
    // the portal is owned by the signed-in organiser, so createRound proceeds.
    portalRows: [{ ownerUserId: 'organiser-1' }] as Array<{ ownerUserId: string | null }>,
  };

  const db = {
    // createRound resolves + authorizes the target portal from the DB BEFORE
    // any upload or write (db.select().from(portals).where(...)).
    select: () => {
      const chain: any = {
        from: () => chain,
        where: () => Promise.resolve(state.portalRows),
      };
      return chain;
    },
    transaction: async (fn: (tx: any) => Promise<any>) => {
      const pending: Array<{ table: any; values: any }> = [];
      const tx = {
        insert: (table: any) => ({
          values: (v: any) => {
            pending.push({ table, values: v });
            const willFail = state.failInsertTable === table;
            const thenable: any = willFail
              ? Promise.reject(new Error('insert failed'))
              : Promise.resolve();
            thenable.returning = () =>
              willFail
                ? Promise.reject(new Error('insert failed'))
                : Promise.resolve([{ id: state.roundId }]);
            return thenable;
          },
        }),
      };
      const result = await fn(tx); // if this throws, nothing below runs
      state.txInserts.push(...pending); // "commit"
      return result;
    },
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.authUser } }) },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          state.uploads.push({ bucket, path });
          return { error: state.uploadError };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.test/${bucket}/${path}` },
        }),
      }),
    },
  };

  return { state, db, supabase };
});

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

// --- helpers ---------------------------------------------------------------

const insertFor = (table: any) =>
  h.state.txInserts.find((i) => i.table === table);

function pdfFile(name = 'paper.pdf') {
  return new File(['%PDF-1.4 fake content'], name, { type: 'application/pdf' });
}

// Valid UUIDs so questionDbId() reuses them as row ids (keeps the physical
// selection's ids lined up 1:1 with the inserted rows in the assertions below).
const UUID1 = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

// A single-choice question that satisfies createRound's answer validation.
// `marks` defaults to '' to mirror exactly what QuestionBuilder submits.
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
  fd.append('name', 'Round One');
  fd.append('orderIndex', '1');
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

const paperForm = (fields: Record<string, string> = {}) =>
  buildForm({ deliveryMethod: 'paper', ...fields }, { questionPaper: pdfFile() });

const hybridForm = (qs: any[], fields: Record<string, string> = {}) =>
  buildForm(
    {
      deliveryMethod: 'hybrid',
      questionsData: JSON.stringify(qs),
      ...fields,
    },
    { questionPaper: pdfFile() }
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.state.authUser = { id: 'organiser-1' };
  h.state.txInserts = [];
  h.state.uploads = [];
  h.state.uploadError = null;
  h.state.failInsertTable = null;
  h.state.revalidated = [];
  h.state.roundId = 'round-1';
  h.state.portalRows = [{ ownerUserId: 'organiser-1' }];
});

describe('createRound', () => {
  it('writes the round, its paper and its questions for an online round', async () => {
    await createRound(
      onlineForm(
        [
          readyMcq({ id: UUID1, marks: '5', difficulty: '1' }),
          readyMcq({
            id: UUID2,
            prompt: 'Capital of France?',
            marks: '5',
            difficulty: '2',
            options: ['Paris', 'Lyon'],
            correctAnswer: 'Paris',
          }),
        ],
        { targetTotalMarks: '10' }
      )
    );

    expect(h.state.txInserts).toHaveLength(3);
    expect(insertFor(rounds)?.values).toMatchObject({
      portalId: 'portal-1',
      name: 'Round One',
      orderIndex: 1,
      deliveryMethod: 'online',
      targetTotalMarks: 10,
    });
    // Online rounds still get a question paper row carrying the time limit,
    // now derived from the open->close window (buildForm defaults to a 2-day
    // window = 2880 minutes) rather than a submitted durationMinutes field.
    expect(insertFor(questionPapers)?.values).toMatchObject({
      roundId: 'round-1',
      durationMinutes: 2880,
      fileUrl: null,
    });
    expect(redirect).toHaveBeenCalledWith('/organiser/olympiads/portal-1');
    expect(h.state.revalidated).toContain('/organiser/olympiads/portal-1');
    expect(h.state.uploads).toHaveLength(0);
  });

  it('persists blank marks/difficulty as null for a physical pool question (regression: "" used to coerce to 1)', async () => {
    // A paper round guards only the SELECTED questions, so an unselected draft
    // question may omit marks/difficulty and still be saved (as null, not 1).
    await createRound(
      paperForm({
        questionsData: JSON.stringify([
          mcq({ id: UUID1, marks: '5', prompt: 'Q1' }),
          mcq({
            id: UUID2,
            marks: '',
            difficulty: '',
            prompt: 'Q2',
            options: ['6', '7'],
            correctAnswer: '6',
          }),
        ]),
        selectedQuestionIds: JSON.stringify([UUID1]),
      })
    );

    const saved = insertFor(questions)!.values;
    expect(saved).toHaveLength(2);
    expect(saved[0].marks).toBe(5); // '5' -> 5
    expect(saved[0].id).toBe(UUID1); // the builder UUID is reused as the row id
    expect(saved[1].marks).toBeNull(); // '' -> null (was 1)
    expect(saved[1].difficulty).toBeNull(); // '' -> null
    expect(saved.every((q: any) => q.roundId === 'round-1')).toBe(true);
  });

  it('persists the organiser-assigned difficulty on each question', async () => {
    await createRound(
      onlineForm([readyMcq({ difficulty: '3' })], { targetTotalMarks: '10' })
    );

    expect(insertFor(questions)!.values[0].difficulty).toBe(3);
  });

  it('persists the unified target total marks on the round', async () => {
    await createRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }));

    expect(insertFor(rounds)!.values.targetTotalMarks).toBe(10);
  });

  it('persists the ordered physical selection for a hybrid round', async () => {
    await createRound(
      hybridForm(
        [
          readyMcq({ id: UUID1, marks: '5', difficulty: '1' }),
          readyMcq({
            id: UUID2,
            prompt: 'Q2',
            marks: '5',
            difficulty: '2',
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

    // Order is preserved exactly as the organiser arranged it.
    expect(insertFor(questionPapers)!.values.selectedQuestionIds).toEqual([
      UUID2,
      UUID1,
    ]);
  });

  it('stores the advancement thresholds when provided', async () => {
    await createRound(
      onlineForm([readyMcq()], {
        qualifyingThreshold: '60',
        thresholdTopN: '50',
        targetTotalMarks: '10',
      })
    );

    expect(insertFor(rounds)?.values).toMatchObject({
      qualifyingThreshold: '60',
      thresholdTopN: 50,
    });
  });

  it('leaves the advancement thresholds unset when the fields are omitted', async () => {
    // Regression: absent (null) threshold fields used to crash on `.trim()`.
    await createRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }));

    const saved = insertFor(rounds)!.values;
    expect(saved.qualifyingThreshold).toBeUndefined();
    expect(saved.thresholdTopN).toBeUndefined();
  });

  it('uploads the PDF and stores its public URL for a paper round, without questions', async () => {
    await createRound(paperForm());

    expect(h.state.uploads).toHaveLength(1);
    expect(h.state.uploads[0].bucket).toBe('round-documents');
    expect(insertFor(questionPapers)?.values).toMatchObject({
      roundId: 'round-1',
      isMultipleChoice: false,
    });
    expect(insertFor(questionPapers)!.values.fileUrl).toContain(
      'https://cdn.test/round-documents/papers/'
    );
    expect(insertFor(questions)).toBeUndefined();
    expect(redirect).toHaveBeenCalledWith('/organiser/olympiads/portal-1');
  });

  it('saves both the paper and the questions for a hybrid round', async () => {
    await createRound(
      hybridForm([readyMcq()], {
        targetTotalMarks: '10',
        selectedQuestionIds: JSON.stringify([UUID1]),
      })
    );

    expect(h.state.uploads).toHaveLength(1);
    expect(insertFor(questionPapers)?.values).toMatchObject({ durationMinutes: 2880 });
    expect(insertFor(questions)!.values).toHaveLength(1);
  });

  it('uploads per-question images to the question-images bucket', async () => {
    const fd = onlineForm([readyMcq({ id: 'qimg' })], { targetTotalMarks: '10' });
    fd.set('image_qimg', new File(['pngbytes'], 'diagram.png', { type: 'image/png' }));

    await createRound(fd);

    expect(h.state.uploads.some((u) => u.bucket === 'question-images')).toBe(true);
    expect(insertFor(questions)!.values[0].imageUrl).toContain(
      'https://cdn.test/question-images/'
    );
  });

  it('commits nothing when a question insert fails mid-transaction (regression: round used to be orphaned)', async () => {
    h.state.failInsertTable = questions;

    await expect(
      createRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }))
    ).rejects.toThrow();

    expect(h.state.txInserts).toHaveLength(0);
    expect(insertFor(rounds)).toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('creates no round when the paper upload fails', async () => {
    h.state.uploadError = { message: 'Bucket not found' };

    await expect(createRound(paperForm())).rejects.toThrow(/Upload failed/);

    expect(h.state.uploads).toHaveLength(1);
    expect(h.state.txInserts).toHaveLength(0);
    expect(insertFor(rounds)).toBeUndefined();
  });

  it('rejects an online question with no valid answer before writing anything', async () => {
    await expect(
      createRound(onlineForm([mcq({ correctAnswer: 'not-an-option' })]))
    ).rejects.toThrow(/requires an answer/);

    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.uploads).toHaveLength(0);
  });

  // --- publish-readiness guard (server-authoritative) ----------------------
  // The guard runs BEFORE any upload or write, so a not-ready round neither
  // leaks a file nor persists half a round. These mirror the advisory client
  // PublishReadinessPanel, which runs the same pure checkers.

  it('blocks publishing an online round when a question is missing its marks', async () => {
    await expect(
      createRound(onlineForm([readyMcq({ marks: '' })], { targetTotalMarks: '10' }))
    ).rejects.toThrow(/not ready to publish/);

    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.uploads).toHaveLength(0);
  });

  it('blocks publishing an online round when a question is missing its difficulty', async () => {
    await expect(
      createRound(
        onlineForm([readyMcq({ difficulty: '' })], { targetTotalMarks: '10' })
      )
    ).rejects.toThrow(/not ready to publish/);

    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.uploads).toHaveLength(0);
  });

  it('blocks publishing an online round when the target total is unreachable', async () => {
    // Two 5-mark questions can only total 0, 5 or 10 — never 7.
    await expect(
      createRound(
        onlineForm(
          [
            readyMcq({ id: UUID1, marks: '5', difficulty: '1' }),
            readyMcq({
              id: UUID2,
              prompt: 'Q2',
              marks: '5',
              difficulty: '2',
              options: ['a', 'b'],
              correctAnswer: 'a',
            }),
          ],
          { targetTotalMarks: '7' }
        )
      )
    ).rejects.toThrow(/not ready to publish/);

    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.uploads).toHaveLength(0);
  });

  it('blocks publishing a hybrid round whose physical selection is empty', async () => {
    await expect(
      createRound(hybridForm([readyMcq()], { targetTotalMarks: '10' }))
    ).rejects.toThrow(/not ready to publish/);

    expect(h.state.txInserts).toHaveLength(0);
    // The guard fires before the paper PDF is uploaded.
    expect(h.state.uploads).toHaveLength(0);
  });

  it('derives the time limit from the open->close window (create no longer submits durationMinutes)', async () => {
    // 09:00 -> 11:30 on the same day is exactly 150 minutes. The manual field is
    // gone from the create form, so this value can only come from the window.
    await createRound(
      onlineForm([readyMcq()], {
        opensAt: '2026-10-01T09:00',
        closesAt: '2026-10-01T11:30',
        targetTotalMarks: '10',
      })
    );

    expect(insertFor(questionPapers)?.values).toMatchObject({ durationMinutes: 150 });
  });

  it('rejects a closing time that is not after the opening time', async () => {
    await expect(
      createRound(
        onlineForm([mcq()], {
          opensAt: '2026-10-05T09:00',
          closesAt: '2026-10-01T09:00',
        })
      )
    ).rejects.toThrow(/Closing time must be after/);

    expect(h.state.txInserts).toHaveLength(0);
  });

  it('requires a signed-in organiser', async () => {
    h.state.authUser = null;

    await expect(createRound(onlineForm([mcq()]))).rejects.toThrow('Unauthorized');

    expect(h.state.txInserts).toHaveLength(0);
  });

  // --- portal authorization (Ryan #4) --------------------------------------
  // A Server Action is a plain POST endpoint: the [olympiadId] URL segment and
  // the submitted portalId are NOT trusted. createRound must resolve the target
  // portal from the DB and confirm the caller owns it BEFORE any upload/write,
  // so a student (or any non-owner) can never author a round into it.

  it('rejects a caller who does not own the target portal (non-owner/student)', async () => {
    // Signed in, but as someone who is not the portal owner.
    h.state.authUser = { id: 'student-1' };

    await expect(
      createRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }))
    ).rejects.toThrow('Not authorized');

    // Nothing uploaded, nothing written.
    expect(h.state.uploads).toHaveLength(0);
    expect(h.state.txInserts).toHaveLength(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('rejects when the target portal does not exist / cannot be resolved', async () => {
    h.state.portalRows = [];

    await expect(
      createRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }))
    ).rejects.toThrow('Not authorized');

    expect(h.state.uploads).toHaveLength(0);
    expect(h.state.txInserts).toHaveLength(0);
  });

  it('authorizes the owner and writes the round', async () => {
    h.state.authUser = { id: 'organiser-1' };
    h.state.portalRows = [{ ownerUserId: 'organiser-1' }];

    await createRound(onlineForm([readyMcq()], { targetTotalMarks: '10' }));

    expect(insertFor(rounds)).toBeDefined();
    expect(redirect).toHaveBeenCalledWith('/organiser/olympiads/portal-1');
  });
});
