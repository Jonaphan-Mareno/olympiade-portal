import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each rate-limited surface must stop BEFORE doing its real work (DB query,
// Supabase call, external API, invite email) and report the limit in the
// shape its callers already handle: HTTP 429 JSON for API routes,
// `{ error }` for Server Actions. The limiter itself is mocked to deny.

const h = vi.hoisted(() => ({
  listPublicPortals: vi.fn(),
  signInWithPassword: vi.fn(),
  getUser: vi.fn(),
  searchUniversities: vi.fn(),
  dbInsert: vi.fn(),
  selectRows: [] as any[],
}));

vi.mock('@/lib/rate-limit', () => ({
  isRateLimitingEnabled: () => true,
  getClientIp: async () => '1.2.3.4',
  checkRateLimit: async () => ({ success: false, retryAfterSeconds: 42 }),
  formatRetryAfter: (s: number) => `${s} seconds`,
  authRateLimitError: async () => 'Too many attempts. Please wait 42 seconds and try again.',
  inviteRateLimitError: async () => 'You have sent a lot of invitations recently.',
}));

vi.mock('@/domain/public-api/queries', () => ({ listPublicPortals: h.listPublicPortals }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: h.getUser, signInWithPassword: h.signInWithPassword },
  }),
}));
vi.mock('@/lib/schools', () => ({
  loadHighSchools: () => [],
  searchHighSchools: () => [],
  searchUniversities: h.searchUniversities,
  UniversitiesApiError: class extends Error {},
}));
vi.mock('@/lib/db', () => ({
  db: {
    select: () => {
      const chain: any = {
        from: () => chain,
        where: () => Promise.resolve(h.selectRows),
      };
      return chain;
    },
    insert: h.dbInsert,
  },
}));
vi.mock('@/lib/email', () => ({ sendInviteEmail: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { GET as portalsGET } from '@/app/api/public/portals/route';
import { GET as suggestGET } from '@/app/api/schools/suggest/route';
import { login } from '@/app/auth/actions';
import { inviteStudents } from '@/app/educator/actions';
import { NextRequest } from 'next/server';

beforeEach(() => {
  vi.clearAllMocks();
  h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  h.selectRows = [];
});

describe('rate-limited surfaces', () => {
  it('public API returns 429 with Retry-After and CORS, without querying the DB', async () => {
    const res = await portalsGET();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await res.json()).retryAfterSeconds).toBe(42);
    expect(h.listPublicPortals).not.toHaveBeenCalled();
  });

  it('university suggestions return 429 without calling the external API', async () => {
    const res = await suggestGET(
      new NextRequest('http://localhost/api/schools/suggest?q=cape&type=university')
    );

    expect(res.status).toBe(429);
    expect(h.searchUniversities).not.toHaveBeenCalled();
  });

  it('login returns the limit as { error } without calling Supabase', async () => {
    const fd = new FormData();
    fd.set('email', 'victim@school.edu');
    fd.set('password', 'guess');

    const result = await login(fd);

    expect(result).toEqual({ error: 'Too many attempts. Please wait 42 seconds and try again.' });
    expect(h.signInWithPassword).not.toHaveBeenCalled();
  });

  it('inviteStudents returns the limit as { error } before writing or emailing', async () => {
    // The caller is a verified educator, so the request reaches the limiter.
    h.selectRows = [{ id: 'educator-membership' }];
    const fd = new FormData();
    fd.set('portalId', 'portal-1');
    fd.set('schoolId', 'school-1');
    fd.append('studentEmails', 'a@mail.com');

    const result = await inviteStudents(fd);

    expect(result).toEqual({ error: 'You have sent a lot of invitations recently.' });
    expect(h.dbInsert).not.toHaveBeenCalled();
  });
});
