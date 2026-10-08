import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression for Ryan #6: the organiser/educator `?variant=preview` branch must
// render EXACTLY the drawn sample variant's questions, in variant order. The
// previous lossless `orderByIds` appended every undrawn pool question after the
// variant — leaking the full pool while students were still sitting and showing
// a preview that no entrant ever receives.
//
// drawVariant / mulberry32 / FIXED_SEED are left REAL so the expected variant is
// recomputed with the very same seed the route uses; only db, supabase auth and
// the PDF generator are mocked.

const h = vi.hoisted(() => {
  const state = {
    // Queued row arrays: [0] = round join, [1] = pool read.
    results: [] as any[][],
    authUser: null as { id: string; email?: string } | null,
    // Every call to generateQuestionPaperPdf, for inspection.
    paperCalls: [] as Array<{ questions: any[]; meta: any }>,
  };
  const asResult = (rows: any[]) => {
    const p = Promise.resolve(rows) as Promise<any[]> & { limit?: () => any };
    p.limit = () => p;
    return p;
  };
  const nextResult = () => asResult(state.results.shift() ?? []);
  const db = {
    select: () => ({
      from: () => ({
        where: () => nextResult(),
        innerJoin: () => ({ where: () => nextResult() }),
      }),
    }),
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.authUser }, error: null }) },
  };
  return { state, db, supabase };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));
vi.mock('@/lib/pdf/online-test-pdf', () => ({
  generateQuestionPaperPdf: vi.fn(async (questions: any[], meta: any) => {
    h.state.paperCalls.push({ questions, meta });
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
  }),
  generateMemoPdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
}));

import { GET } from '@/app/api/rounds/[roundId]/paper/route';
import { generateQuestionPaperPdf } from '@/lib/pdf/online-test-pdf';
import { drawVariant, mulberry32 } from '@/domain/question-bank/variant-generator';
import { FIXED_SEED } from '@/domain/question-bank/publish-readiness';

const ROUND_ID = 'round-1';
const ORGANISER_ID = 'organiser-1';

// Five-question pool, 5 marks each; the target of 10 means a drawn variant is a
// strict 2-question subset, leaving 3 undrawn questions that must NOT appear.
function poolRow(id: string, difficulty: number) {
  return {
    id,
    roundId: ROUND_ID,
    questionType: 'multiple-choice',
    prompt: `Prompt ${id}`,
    marks: 5,
    difficulty,
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    imageUrl: null,
  };
}
const POOL_ROWS = [
  poolRow('q-1', 1),
  poolRow('q-2', 2),
  poolRow('q-3', 3),
  poolRow('q-4', 4),
  poolRow('q-5', 5),
];
const TARGET_TOTAL_MARKS = 10;

function roundRow() {
  return {
    id: ROUND_ID,
    name: 'Round 1',
    portalId: 'portal-1',
    opensAt: new Date('2026-09-01T09:00:00Z'),
    closesAt: new Date('2026-09-10T17:00:00Z'),
    targetTotalMarks: TARGET_TOTAL_MARKS,
    portalName: 'Maths Olympiad',
    ownerUserId: ORGANISER_ID,
  };
}

function previewRequest() {
  return new Request(
    `http://localhost:3000/api/rounds/${ROUND_ID}/paper?variant=preview`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.paperCalls = [];
  h.state.authUser = { id: ORGANISER_ID, email: 'org@example.com' };
  h.state.results = [[roundRow()], POOL_ROWS];
});

describe('GET /api/rounds/[roundId]/paper?variant=preview', () => {
  it('renders EXACTLY the drawn variant — no undrawn pool questions appended', async () => {
    const res = await GET(previewRequest(), {
      params: Promise.resolve({ roundId: ROUND_ID }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(generateQuestionPaperPdf).toHaveBeenCalledTimes(1);

    // Recompute the same variant the route draws (identical fixed seed).
    const expected = drawVariant(
      POOL_ROWS.map((q) => ({ id: q.id, marks: q.marks, difficulty: q.difficulty })),
      TARGET_TOTAL_MARKS,
      mulberry32(FIXED_SEED)
    );

    // Sanity: the draw is a strict subset, so the leak this fixes is observable.
    expect(expected.questionIds.length).toBeGreaterThan(0);
    expect(expected.questionIds.length).toBeLessThan(POOL_ROWS.length);

    const renderedIds = h.state.paperCalls[0].questions.map((q: any) => q.id);

    // Only the drawn questions, in variant order — nothing else.
    expect(renderedIds).toEqual(expected.questionIds);

    // The undrawn pool questions must be entirely absent from the preview.
    const drawn = new Set(expected.questionIds);
    const undrawn = POOL_ROWS.map((q) => q.id).filter((id) => !drawn.has(id));
    expect(undrawn.length).toBeGreaterThan(0);
    for (const id of undrawn) {
      expect(renderedIds).not.toContain(id);
    }
  });

  it('labels the sample variant PDF distinctly from the real paper', async () => {
    const res = await GET(previewRequest(), {
      params: Promise.resolve({ roundId: ROUND_ID }),
    });

    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('sample-variant');
    expect(h.state.paperCalls[0].meta.subtitle).toContain('sample variant');
  });

  it('returns 404 when the round has no questions to preview', async () => {
    h.state.results = [[roundRow()], []];

    const res = await GET(previewRequest(), {
      params: Promise.resolve({ roundId: ROUND_ID }),
    });

    expect(res.status).toBe(404);
    expect(generateQuestionPaperPdf).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller', async () => {
    h.state.authUser = null;

    const res = await GET(previewRequest(), {
      params: Promise.resolve({ roundId: ROUND_ID }),
    });

    expect(res.status).toBe(401);
    expect(generateQuestionPaperPdf).not.toHaveBeenCalled();
  });
});
