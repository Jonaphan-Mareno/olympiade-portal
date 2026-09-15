import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/student/sitting/sync/route';
import { createClient } from '@/lib/supabase/server';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const { mockSelect, mockWhere } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockSelect, mockWhere };
});

vi.mock('@/lib/db', () => ({
  db: {
    select: mockSelect,
  },
}));

describe('GET /api/student/sitting/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const req = new Request('http://localhost:3000/api/student/sitting/sync');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 if sittingId is missing', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: '123' } } }) },
    });

    const req = new Request('http://localhost:3000/api/student/sitting/sync');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 if sitting is not found', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: '123' } } }) },
    });

    // Mock DB response for sitting: empty array
    mockWhere.mockResolvedValueOnce([]);

    const req = new Request('http://localhost:3000/api/student/sitting/sync?sittingId=1');
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it('returns sitting and answers if sitting is found', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: '123' } } }) },
    });

    // Mock DB response for sitting
    const mockSitting = { id: '1', examId: 'exam1' };
    const mockAnswers = [{ id: 'a1', questionId: 'q1', answer: 'A' }];
    
    mockWhere
      .mockResolvedValueOnce([mockSitting]) // sitting query
      .mockResolvedValueOnce(mockAnswers);  // answers query

    const req = new Request('http://localhost:3000/api/student/sitting/sync?sittingId=1');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sitting).toEqual(mockSitting);
    expect(json.answers).toEqual(mockAnswers);
  });
});
