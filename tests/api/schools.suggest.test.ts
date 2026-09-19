import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/schools/suggest/route';
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  loadHighSchools,
  searchHighSchools,
  searchUniversities,
  UniversitiesApiError,
} from '@/lib/schools';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/schools', () => ({
  loadHighSchools: vi.fn(),
  searchHighSchools: vi.fn(),
  searchUniversities: vi.fn(),
  UniversitiesApiError: class UniversitiesApiError extends Error {},
}));

function authedUser() {
  (createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: '123' } } }),
    },
  });
}

function request(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost:3000/api/schools/suggest?${query}`);
}

describe('GET /api/schools/suggest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const res = await GET(request({ q: 'test', type: 'high_school' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 if type is missing', async () => {
    authedUser();

    const res = await GET(request({ q: 'test' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('type');
  });

  it('returns 400 if type is not a known school type', async () => {
    authedUser();

    const res = await GET(request({ q: 'test', type: 'primary' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('type');
  });

  it('returns an empty array if the query is shorter than 2 characters', async () => {
    authedUser();

    const res = await GET(request({ q: 'a', type: 'high_school' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([]);
    expect(searchHighSchools).not.toHaveBeenCalled();
    expect(searchUniversities).not.toHaveBeenCalled();
  });

  it('searches the local high-school snapshot for type=high_school', async () => {
    authedUser();
    const records = [
      {
        id: 1,
        natEmis: '700401012',
        name: 'PRETORIA BOYS HIGH SCHOOL',
        province: 'Gauteng',
        town: 'PRETORIA',
        phase: 'SECONDARY SCHOOL',
      },
    ];
    (loadHighSchools as any).mockReturnValue(records);
    (searchHighSchools as any).mockReturnValue([
      {
        name: 'PRETORIA BOYS HIGH SCHOOL',
        type: 'high_school',
        province: 'Gauteng',
        town: 'PRETORIA',
        externalId: '700401012',
      },
    ]);

    const res = await GET(request({ q: 'pretoria boys', type: 'high_school' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([
      {
        name: 'PRETORIA BOYS HIGH SCHOOL',
        type: 'high_school',
        province: 'Gauteng',
        town: 'PRETORIA',
        externalId: '700401012',
      },
    ]);
    // The snapshot is searched locally - no upstream call for high schools.
    expect(searchHighSchools).toHaveBeenCalledWith(records, 'pretoria boys');
    expect(searchUniversities).not.toHaveBeenCalled();
  });

  it('proxies the universities API for type=university', async () => {
    authedUser();
    (searchUniversities as any).mockResolvedValue([
      {
        name: 'University of Cape Town',
        type: 'university',
        country: 'South Africa',
        externalId: 'uct.ac.za',
      },
    ]);

    const res = await GET(request({ q: 'cape town', type: 'university' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([
      {
        name: 'University of Cape Town',
        type: 'university',
        country: 'South Africa',
        externalId: 'uct.ac.za',
      },
    ]);
    expect(searchUniversities).toHaveBeenCalledWith('cape town');
    expect(loadHighSchools).not.toHaveBeenCalled();
  });

  it('returns 502 when the universities API is unreachable', async () => {
    authedUser();
    (searchUniversities as any).mockRejectedValue(
      new UniversitiesApiError('HTTP 503')
    );

    const res = await GET(request({ q: 'cape town', type: 'university' }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain('University search');
  });
});
