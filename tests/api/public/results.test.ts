import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/public/results/route';
import {
  getPublicRoundContext,
  listRoundScores,
} from '@/domain/public-api/queries';

vi.mock('@/domain/public-api/queries', () => ({
  getPublicRoundContext: vi.fn(),
  listRoundScores: vi.fn(),
}));

const HOUR_MS = 60 * 60 * 1000;

function request(params: Record<string, string> = {}) {
  return new Request(
    `http://localhost:3000/api/public/results?${new URLSearchParams(params)}`
  );
}

function context(overrides: { resultsPublishedAt?: Date | null } = {}) {
  return {
    round: {
      id: 'round-1',
      name: 'Round 1',
      opensAt: new Date(Date.now() - 48 * HOUR_MS),
      closesAt: new Date(Date.now() - 24 * HOUR_MS),
      resultsPublishedAt: null,
      ...overrides,
    },
    portal: { id: 'portal-1', name: 'Maths Olympiad' },
  };
}

describe('GET /api/public/results', () => {
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

  it('returns 403 while the results are unpublished', async () => {
    (getPublicRoundContext as any).mockResolvedValue(context());

    const res = await GET(request({ round_id: 'round-1' }));

    expect(res.status).toBe(403);
    expect(listRoundScores).not.toHaveBeenCalled();
  });

  it('returns anonymous marks, highest first, once published', async () => {
    (getPublicRoundContext as any).mockResolvedValue(
      context({ resultsPublishedAt: new Date(Date.now() - HOUR_MS) })
    );
    (listRoundScores as any).mockResolvedValue([17, 15, 12]);

    const res = await GET(request({ round_id: 'round-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(listRoundScores).toHaveBeenCalledWith('round-1');
    expect(json).toEqual({
      round: { id: 'round-1', name: 'Round 1' },
      portal: { id: 'portal-1', name: 'Maths Olympiad' },
      results: [{ score: 17 }, { score: 15 }, { score: 12 }],
    });
  });

  it('allows cross-origin reads', async () => {
    (getPublicRoundContext as any).mockResolvedValue(context());

    const res = await GET(request({ round_id: 'round-1' }));

    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
