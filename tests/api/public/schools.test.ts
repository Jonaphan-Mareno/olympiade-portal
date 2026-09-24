import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/public/schools/route';
import { listPublicSchools } from '@/domain/public-api/queries';

vi.mock('@/domain/public-api/queries', () => ({
  listPublicSchools: vi.fn(),
}));

describe('GET /api/public/schools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the school directory', async () => {
    (listPublicSchools as any).mockResolvedValue([
      { name: 'PRETORIA BOYS HIGH SCHOOL', external_id: '700401012' },
      { name: 'University of Cape Town', external_id: 'uct.ac.za' },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([
      { name: 'PRETORIA BOYS HIGH SCHOOL', external_id: '700401012' },
      { name: 'University of Cape Town', external_id: 'uct.ac.za' },
    ]);
  });

  it('needs no authentication and allows cross-origin reads', async () => {
    (listPublicSchools as any).mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns 500 when the query fails', async () => {
    (listPublicSchools as any).mockRejectedValue(new Error('db unreachable'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
