import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/public/rounds/route';
import { listPublicRounds } from '@/domain/public-api/queries';

vi.mock('@/domain/public-api/queries', () => ({
  listPublicRounds: vi.fn(),
}));

describe('GET /api/public/rounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns every round with its portal, threshold and schedule', async () => {
    (listPublicRounds as any).mockResolvedValue([
      {
        id: 'round-1',
        name: 'Round 1',
        qualifying_threshold: 30.5,
        opens_at: new Date('2026-03-01T09:00:00Z'),
        closes_at: new Date('2026-03-10T17:00:00Z'),
        portal: { id: 'portal-1', name: 'Maths Olympiad' },
      },
      {
        id: 'round-2',
        name: 'Round 2',
        qualifying_threshold: null,
        opens_at: new Date('2026-04-01T09:00:00Z'),
        closes_at: new Date('2026-04-10T17:00:00Z'),
        portal: { id: 'portal-1', name: 'Maths Olympiad' },
      },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([
      {
        id: 'round-1',
        name: 'Round 1',
        qualifying_threshold: 30.5,
        opens_at: '2026-03-01T09:00:00.000Z',
        closes_at: '2026-03-10T17:00:00.000Z',
        portal: { id: 'portal-1', name: 'Maths Olympiad' },
      },
      {
        id: 'round-2',
        name: 'Round 2',
        qualifying_threshold: null,
        opens_at: '2026-04-01T09:00:00.000Z',
        closes_at: '2026-04-10T17:00:00.000Z',
        portal: { id: 'portal-1', name: 'Maths Olympiad' },
      },
    ]);
  });

  it('needs no authentication and allows cross-origin reads', async () => {
    (listPublicRounds as any).mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns 500 when the query fails', async () => {
    (listPublicRounds as any).mockRejectedValue(new Error('db unreachable'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
