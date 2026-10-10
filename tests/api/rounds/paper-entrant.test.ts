import { describe, it, expect, vi, beforeEach } from 'vitest';

// An entrant may download the paper and memo of a round they wrote, but only
// once results are published (when their marked script also appears). Staff
// access is unchanged; the variant preview stays staff-only.

const h = vi.hoisted(() => ({
  results: [] as any[][],
  authUser: { id: 'student-1' } as { id: string } | null,
}));

vi.mock('@/lib/db', () => {
  const next = () => {
    const p: any = Promise.resolve(h.results.shift() ?? []);
    p.limit = () => p;
    return p;
  };
  const chain: any = { where: () => next() };
  chain.innerJoin = () => chain;
  return { db: { select: () => ({ from: () => chain }) } };
});
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.authUser }, error: null }) },
  }),
}));
vi.mock('@/lib/pdf/online-test-pdf', () => ({
  generateQuestionPaperPdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  generateMemoPdf: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
}));
vi.mock('@/domain/question-bank/load-variant', () => ({
  loadPaperQuestions: vi.fn(async () => [
    { id: 'q1', questionType: 'single_choice', prompt: 'P', marks: 1, options: ['A'], correctAnswer: 'A' },
  ]),
  orderByIdsStrict: (rows: any[]) => rows,
}));

import { GET } from '@/app/api/rounds/[roundId]/paper/route';

const round = (over: Record<string, unknown> = {}) => ({
  id: 'round-1',
  name: 'Round 1',
  portalId: 'portal-1',
  opensAt: new Date('2026-08-01T08:00:00Z'),
  closesAt: new Date('2026-08-01T10:00:00Z'),
  targetTotalMarks: null,
  resultsPublishedAt: new Date('2026-08-10T10:00:00Z'),
  portalName: 'Olympiad',
  ownerUserId: 'organiser-1',
  ...over,
});

const call = (query = 'kind=memo') =>
  GET(new Request(`http://localhost/api/rounds/round-1/paper?${query}`), {
    params: Promise.resolve({ roundId: 'round-1' }),
  });

beforeEach(() => {
  h.results = [];
  h.authUser = { id: 'student-1' };
});

describe('GET /api/rounds/[roundId]/paper — entrants', () => {
  it('serves the memo to an entrant of the round after publication', async () => {
    h.results = [
      [round()],
      [], // not an educator
      [{ id: 'sub-1' }], // wrote this round
      [{ fileUrl: null, answerKeyJson: null, selectedQuestionIds: null }], // paper
    ];
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('refuses before results are published', async () => {
    h.results = [[round({ resultsPublishedAt: null })], []];
    expect((await call()).status).toBe(403);
  });

  it('refuses a student who did not write the round', async () => {
    h.results = [[round()], [], []];
    expect((await call()).status).toBe(403);
  });

  it('never gives entrants the variant preview', async () => {
    h.results = [[round()], []];
    expect((await call('variant=preview')).status).toBe(403);
  });
});
