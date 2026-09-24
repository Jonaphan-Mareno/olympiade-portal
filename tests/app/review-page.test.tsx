import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ReviewPage from '@/app/(student)/results/[portalId]/rounds/[roundId]/review/page';

// The round review page must present a student's mark as the raw score out of
// the round's total, plus the percentage. Rounds with no questions in the
// bank (e.g. manually graded paper rounds) have no computable total and fall
// back to the raw mark alone.

const h = vi.hoisted(() => {
  const state = {
    // Queued row arrays, one per select() the page performs
    selectRows: [] as any[][],
    notFoundCalls: 0,
    authUser: null as { id: string; email?: string } | null,
  };

  // `.where(...)` is awaited directly for the questions query but chained
  // with `.limit(1)` for the membership and submission queries, so return a
  // promise that also exposes `limit`.
  const whereResult = (rows: any[]) => {
    const p = Promise.resolve(rows) as Promise<any[]> & {
      limit?: () => Promise<any[]>;
    };
    p.limit = () => p;
    return p;
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => whereResult(state.selectRows.shift() ?? []),
        leftJoin: () => ({
          where: () => whereResult(state.selectRows.shift() ?? []),
        }),
      }),
    }),
  };

  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: state.authUser }, error: null }),
    },
  };

  return { state, db, supabase };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    h.state.notFoundCalls += 1;
    throw new Error('NOT_FOUND');
  },
}));

async function renderPage() {
  // params is a Promise in Next 16 server components
  const page = await ReviewPage({
    params: Promise.resolve({ portalId: 'portal-1', roundId: 'round-1' }),
  });
  render(page);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.selectRows = [];
  h.state.notFoundCalls = 0;
  h.state.authUser = { id: 'user-1', email: 'student@example.com' };
});

describe('ReviewPage score display', () => {
  it('shows the raw mark out of the total and the percentage', async () => {
    h.state.selectRows = [
      [{ id: 'membership-1', userId: 'user-1', portalId: 'portal-1' }], // membership
      [{ id: 'round-1', opensAt: new Date(0), closesAt: new Date(0), resultsPublishedAt: new Date() }], // round
      [
        {
          submission: { id: 'sub-1', answersJson: { 'q-1': '4' } },
          result: { score: '18', feedback: 'Auto-marked: 18 / 25' },
        },
      ], // submission + result
      [
        { id: 'q-1', prompt: 'What is 2 + 2?', marks: 5, correctAnswer: '4' },
        { id: 'q-2', prompt: 'What is 3 + 3?', marks: 10, correctAnswer: '6' },
        { id: 'q-3', prompt: 'What is 4 + 4?', marks: 10, correctAnswer: '8' },
      ], // questions: 25 marks total
    ];

    await renderPage();

    expect(screen.getByText('18 / 25')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('Final Score')).toBeInTheDocument();
  });

  it('shows the raw mark alone when the round has no questions', async () => {
    h.state.selectRows = [
      [{ id: 'membership-1', userId: 'user-1', portalId: 'portal-1' }], // membership
      [{ id: 'round-1', opensAt: new Date(0), closesAt: new Date(0), resultsPublishedAt: new Date() }], // round
      [
        {
          submission: { id: 'sub-1', answersJson: {} },
          result: { score: '14', feedback: null },
        },
      ], // manually graded paper submission
      [], // no questions in the bank
    ];

    await renderPage();

    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('treats a missing result as zero marks', async () => {
    h.state.selectRows = [
      [{ id: 'membership-1', userId: 'user-1', portalId: 'portal-1' }], // membership
      [{ id: 'round-1', opensAt: new Date(0), closesAt: new Date(0), resultsPublishedAt: new Date() }], // round
      [
        {
          submission: { id: 'sub-1', answersJson: {} },
          result: null,
        },
      ], // submitted but not graded yet
      [
        { id: 'q-1', prompt: 'What is 2 + 2?', marks: 5, correctAnswer: '4' },
        { id: 'q-2', prompt: 'What is 3 + 3?', marks: 5, correctAnswer: '6' },
      ], // questions: 10 marks total
    ];

    await renderPage();

    expect(screen.getByText('0 / 10')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('returns not-found when the student has no submission for the round', async () => {
    h.state.selectRows = [
      [{ id: 'membership-1', userId: 'user-1', portalId: 'portal-1' }], // membership
      [{ id: 'round-1', opensAt: new Date(0), closesAt: new Date(0), resultsPublishedAt: new Date() }], // round
      [], // no submission
    ];

    await expect(renderPage()).rejects.toThrow('NOT_FOUND');
    expect(h.state.notFoundCalls).toBe(1);
  });
});
