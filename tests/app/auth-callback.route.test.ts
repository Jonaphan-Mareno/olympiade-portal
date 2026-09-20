import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/auth/callback/route';

// /auth/callback exchanges the one-time recovery code from the reset email
// for a session, then forwards to /reset-password. It must survive Vercel's
// forwarded-host routing and refuse to redirect anywhere off-site.

const h = vi.hoisted(() => {
  const state = {
    exchangeCalls: [] as string[],
    exchangeError: null as { message: string } | null,
  };

  const supabase = {
    auth: {
      exchangeCodeForSession: async (code: string) => {
        state.exchangeCalls.push(code);
        return { data: { session: null }, error: state.exchangeError };
      },
    },
  };

  return { state, supabase };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  h.state.exchangeCalls = [];
  h.state.exchangeError = null;
});

describe('/auth/callback', () => {
  it('exchanges the code and forwards to /reset-password by default', async () => {
    const res = await GET(
      new Request('http://localhost:3000/auth/callback?code=recovery-code')
    );

    expect(h.state.exchangeCalls).toEqual(['recovery-code']);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/reset-password'
    );
  });

  it('honours a safe ?next= target', async () => {
    const res = await GET(
      new Request(
        'http://localhost:3000/auth/callback?code=recovery-code&next=/dashboard'
      )
    );

    expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });

  it('refuses external redirect targets (open-redirect guard)', async () => {
    const res = await GET(
      new Request(
        'http://localhost:3000/auth/callback?code=recovery-code&next=https://evil.example.com'
      )
    );

    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/reset-password'
    );
  });

  it('refuses protocol-relative redirect targets', async () => {
    const res = await GET(
      new Request(
        'http://localhost:3000/auth/callback?code=recovery-code&next=//evil.example.com'
      )
    );

    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/reset-password'
    );
  });

  it('sends the user back to request a new link when the code is missing', async () => {
    const res = await GET(new Request('http://localhost:3000/auth/callback'));

    expect(h.state.exchangeCalls).toHaveLength(0);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/forgot-password?resetLink=invalid'
    );
  });

  it('sends the user back to request a new link when the exchange fails', async () => {
    h.state.exchangeError = { message: 'invalid request: both auth code and code verifier should be non-empty' };

    const res = await GET(
      new Request('http://localhost:3000/auth/callback?code=stale-code')
    );

    expect(h.state.exchangeCalls).toEqual(['stale-code']);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/forgot-password?resetLink=invalid'
    );
  });

  it('redirects to the forwarded host on Vercel (preview deployments)', async () => {
    const res = await GET(
      new Request('http://localhost:3000/auth/callback?code=recovery-code', {
        headers: {
          'x-forwarded-host': 'preview.vercel.app',
          'x-forwarded-proto': 'https',
        },
      })
    );

    expect(res.headers.get('location')).toBe(
      'https://preview.vercel.app/reset-password'
    );
  });

  it('keeps http when Next dev injects x-forwarded-host on a local request', async () => {
    // Regression: blindly upgrading the forwarded host to https produced
    // https://localhost:3000/... in local dev, where nothing serves TLS.
    const res = await GET(
      new Request('http://localhost:3000/auth/callback?code=recovery-code', {
        headers: { 'x-forwarded-host': 'localhost:3000' },
      })
    );

    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/reset-password'
    );
  });

  it('honours the first host when a chain of proxies forwards several', async () => {
    const res = await GET(
      new Request('http://localhost:3000/auth/callback?code=recovery-code', {
        headers: {
          'x-forwarded-host': 'olympiad.example.com, internal.proxy',
          'x-forwarded-proto': 'https, http',
        },
      })
    );

    expect(res.headers.get('location')).toBe(
      'https://olympiad.example.com/reset-password'
    );
  });
});
