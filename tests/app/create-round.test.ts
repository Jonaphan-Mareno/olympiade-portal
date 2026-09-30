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
  };

  const db = {
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

// A single-choice question that satisfies createRound's validation. `marks`
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
    durationMinutes: '90',
    questionsData: JSON.stringify(qs),
    ...fields,
  });

const paperForm = (fields: Record<string, string> = {}) =>
  buildForm({ deliveryMethod: 'paper', ...fields }, { questionPaper: pdfFile() });

const hybridForm = (qs: any[], fields: Record<string, string> = {}) =>
  buildForm(
    {
      deliveryMethod: 'hybrid',
      durationMinutes: '75',
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
});

describe('createRound', () => {
  it('writes the round, its paper and its questions for an online round', async () => {
    await createRound(
      onlineForm([
        mcq({ marks: '' }),
        mcq({
          id: 'q2',
          prompt: 'Capital of France?',
          marks: '5',
          options: ['Paris', 'Lyon'],
          correctAnswer: 'Paris',
        }),
      ])
    );

    expect(h.state.txInserts).toHaveLength(3);
    expect(insertFor(rounds)?.values).toMatchObject({
      portalId: 'portal-1',
      name: 'Round One',
      orderIndex: 1,
      deliveryMethod: 'online',
    });
    // Online rounds still get a question paper row carrying the time limit.
    expect(insertFor(questionPapers)?.values).toMatchObject({
      roundId: 'round-1',
      durationMinutes: 90,
      fileUrl: null,
    });
    expect(redirect).toHaveBeenCalledWith('/organiser/olympiads/portal-1');
    expect(h.state.revalidated).toContain('/organiser/olympiads/portal-1');
    expect(h.state.uploads).toHaveLength(0);
  });

  it('coerces blank and string marks to integers (regression: "" used to abort the insert)', async () => {
    await createRound(
      onlineForm([
        mcq({ marks: '' }),
        mcq({ id: 'q2', marks: '5', prompt: 'p', options: ['4', '5'], correctAnswer: '4' }),
      ])
    );

    const saved = insertFor(questions)!.values;
    expect(saved).toHaveLength(2);
    expect(saved[0].marks).toBe(1); // ''  -> fallback 1
    expect(saved[1].marks).toBe(5); // '5' -> 5
    expect(typeof saved[0].marks).toBe('number');
    expect(typeof saved[1].marks).toBe('number');
    expect(saved.every((q: any) => q.roundId === 'round-1')).toBe(true);
  });

  it('stores the advancement thresholds when provided', async () => {
    await createRound(
      onlineForm([mcq()], { qualifyingThreshold: '60', thresholdTopN: '50' })
    );

    expect(insertFor(rounds)?.values).toMatchObject({
      qualifyingThreshold: '60',
      thresholdTopN: 50,
    });
  });

  it('leaves the advancement thresholds unset when the fields are omitted', async () => {
    // Regression: absent (null) threshold fields used to crash on `.trim()`.
    await createRound(onlineForm([mcq()]));

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
    await createRound(hybridForm([mcq()]));

    expect(h.state.uploads).toHaveLength(1);
    expect(insertFor(questionPapers)?.values).toMatchObject({ durationMinutes: 75 });
    expect(insertFor(questions)!.values).toHaveLength(1);
  });

  it('uploads per-question images to the question-images bucket', async () => {
    const fd = onlineForm([mcq({ id: 'qimg' })]);
    fd.set('image_qimg', new File(['pngbytes'], 'diagram.png', { type: 'image/png' }));

    await createRound(fd);

    expect(h.state.uploads.some((u) => u.bucket === 'question-images')).toBe(true);
    expect(insertFor(questions)!.values[0].imageUrl).toContain(
      'https://cdn.test/question-images/'
    );
  });

  it('commits nothing when a question insert fails mid-transaction (regression: round used to be orphaned)', async () => {
    h.state.failInsertTable = questions;

    await expect(createRound(onlineForm([mcq()]))).rejects.toThrow();

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
});
