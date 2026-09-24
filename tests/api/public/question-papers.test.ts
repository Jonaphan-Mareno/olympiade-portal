import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/public/question-papers/route';
import {
  getPublicRoundContext,
  listRoundQuestionPapers,
} from '@/domain/public-api/queries';

vi.mock('@/domain/public-api/queries', () => ({
  getPublicRoundContext: vi.fn(),
  listRoundQuestionPapers: vi.fn(),
}));

const HOUR_MS = 60 * 60 * 1000;

function request(params: Record<string, string> = {}) {
  return new Request(
    `http://localhost:3000/api/public/question-papers?${new URLSearchParams(params)}`
  );
}

function context(overrides: { opensAt?: Date; closesAt?: Date } = {}) {
  return {
    round: {
      id: 'round-1',
      name: 'Round 1',
      opensAt: new Date(Date.now() - 48 * HOUR_MS),
      // Closed by default: closes_at is in the past.
      closesAt: new Date(Date.now() - 24 * HOUR_MS),
      resultsPublishedAt: null,
      ...overrides,
    },
    portal: { id: 'portal-1', name: 'Maths Olympiad' },
  };
}

describe('GET /api/public/question-papers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when round_id is missing', async () => {
    const res = await GET(request());

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown round', async () => {
    (getPublicRoundContext as any).mockResolvedValue(null);

    const res = await GET(request({ round_id: 'unknown' }));

    expect(res.status).toBe(404);
  });

  it('returns 403 while the round is still open', async () => {
    (getPublicRoundContext as any).mockResolvedValue(
      context({ closesAt: new Date(Date.now() + 24 * HOUR_MS) })
    );

    const res = await GET(request({ round_id: 'round-1' }));

    expect(res.status).toBe(403);
    expect(listRoundQuestionPapers).not.toHaveBeenCalled();
  });

  it('returns the papers once the round has closed', async () => {
    (getPublicRoundContext as any).mockResolvedValue(context());
    (listRoundQuestionPapers as any).mockResolvedValue([
      {
        id: 'paper-1',
        public_url: 'https://storage.example/papers/paper-1.pdf',
      },
    ]);

    const res = await GET(request({ round_id: 'round-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(listRoundQuestionPapers).toHaveBeenCalledWith('round-1');
    expect(json).toEqual({
      round: { id: 'round-1', name: 'Round 1' },
      portal: { id: 'portal-1', name: 'Maths Olympiad' },
      question_papers: [
        {
          id: 'paper-1',
          public_url: 'https://storage.example/papers/paper-1.pdf',
        },
      ],
    });
  });

  it('allows cross-origin reads', async () => {
    (getPublicRoundContext as any).mockResolvedValue(
      context({ closesAt: new Date(Date.now() + 24 * HOUR_MS) })
    );

    const res = await GET(request({ round_id: 'round-1' }));

    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
