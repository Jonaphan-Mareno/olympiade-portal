import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/schools/search/route';
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
  },
}));

describe('GET /api/schools/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) }
    });

    const req = new NextRequest('http://localhost:3000/api/schools/search?q=test');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('returns empty array if query is missing', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: '123' } } }) }
    });

    const req = new NextRequest('http://localhost:3000/api/schools/search');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([]);
  });

  it('returns empty array if query length is less than 2', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: '123' } } }) }
    });

    const req = new NextRequest('http://localhost:3000/api/schools/search?q=a');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([]);
  });

  it('returns search results for valid query', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: '123' } } }) }
    });

    mockLimit.mockResolvedValue([
      { id: '1', name: 'Test High School' }
    ]);

    const req = new NextRequest('http://localhost:3000/api/schools/search?q=test');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([{ id: '1', name: 'Test High School' }]);
  });
});
