import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/public/portals/route';
import { listPublicPortals } from '@/domain/public-api/queries';

vi.mock('@/domain/public-api/queries', () => ({
  listPublicPortals: vi.fn(),
}));

describe('GET /api/public/portals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns every portal with its status and schools', async () => {
    (listPublicPortals as any).mockResolvedValue([
      {
        id: 'portal-1',
        name: 'Maths Olympiad',
        created_at: new Date('2026-01-01T00:00:00Z'),
        status: 'approved',
        schools: [{ name: 'Alpha High', external_id: 'A1' }],
      },
      {
        id: 'portal-2',
        name: 'Physics Olympiad',
        created_at: new Date('2026-02-01T00:00:00Z'),
        status: 'pending',
        schools: [],
      },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([
      {
        id: 'portal-1',
        name: 'Maths Olympiad',
        created_at: '2026-01-01T00:00:00.000Z',
        status: 'approved',
        schools: [{ name: 'Alpha High', external_id: 'A1' }],
      },
      {
        id: 'portal-2',
        name: 'Physics Olympiad',
        created_at: '2026-02-01T00:00:00.000Z',
        status: 'pending',
        schools: [],
      },
    ]);
  });

  it('needs no authentication and allows cross-origin reads', async () => {
    (listPublicPortals as any).mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns 500 when the query fails', async () => {
    (listPublicPortals as any).mockRejectedValue(new Error('db unreachable'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
