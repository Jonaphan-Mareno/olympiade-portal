import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/public/questions/route';
import {
  getPublicRoundContext,
  listRoundQuestions,
} from '@/domain/public-api/queries';

vi.mock('@/domain/public-api/queries', () => ({
  getPublicRoundContext: vi.fn(),
  listRoundQuestions: vi.fn(),
}));

const HOUR_MS = 60 * 60 * 1000;

function request(params: Record<string, string> = {}) {
  return new Request(
    `http://localhost:3000/api/public/questions?${new URLSearchParams(params)}`
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

describe('GET /api/public/questions', () => {
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

  it('returns 403 while the round has not opened yet', async () => {
    (getPublicRoundContext as any).mockResolvedValue(
      context({
        opensAt: new Date(Date.now() + 24 * HOUR_MS),
        closesAt: new Date(Date.now() + 48 * HOUR_MS),
      })
    );

    const res = await GET(request({ round_id: 'round-1' }));

    expect(res.status).toBe(403);
    expect(listRoundQuestions).not.toHaveBeenCalled();
  });

  it('returns 403 while the round is still open', async () => {
    (getPublicRoundContext as any).mockResolvedValue(
      context({ closesAt: new Date(Date.now() + 24 * HOUR_MS) })
    );

    const res = await GET(request({ round_id: 'round-1' }));

    expect(res.status).toBe(403);
    expect(listRoundQuestions).not.toHaveBeenCalled();
  });

  it('returns the questions, correct answers included, once closed', async () => {
    (getPublicRoundContext as any).mockResolvedValue(context());
    (listRoundQuestions as any).mockResolvedValue([
      {
        id: 'q1',
        question_type: 'single_choice',
        prompt: 'What is 2 + 2?',
        options: ['3', '4'],
        correct_answer: '4',
        marks: 2,
        image_url: null,
      },
    ]);

    const res = await GET(request({ round_id: 'round-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(listRoundQuestions).toHaveBeenCalledWith('round-1');
    expect(json).toEqual({
      round: { id: 'round-1', name: 'Round 1' },
      portal: { id: 'portal-1', name: 'Maths Olympiad' },
      questions: [
        {
          id: 'q1',
          question_type: 'single_choice',
          prompt: 'What is 2 + 2?',
          options: ['3', '4'],
          correct_answer: '4',
          marks: 2,
          image_url: null,
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
