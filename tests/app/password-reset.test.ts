import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestPasswordReset, resetPassword } from '@/app/auth/actions';

// Password reset flow: requestPasswordReset must never reveal whether an
// email has an account (anti-enumeration), and resetPassword must only
// accept a session created by the recovery-link callback.

const h = vi.hoisted(() => {
  const state = {
    profileRows: [] as any[][],
    resetCalls: [] as { email: string; redirectTo: string }[],
    resetError: null as { message: string } | null,
    currentUser: null as { id: string; email: string } | null,
    updateCalls: [] as Record<string, unknown>[],
    updateError: null as { message: string } | null,
    redirectCalls: [] as string[],
    originHeader: 'http://localhost:3000' as string | null,
    baseUrl: undefined as string | undefined,
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.profileRows.shift() ?? []),
      }),
    }),
  };

  const supabase = {
    auth: {
      resetPasswordForEmail: async (
        email: string,
        options: { redirectTo: string }
      ) => {
        state.resetCalls.push({ email, redirectTo: options.redirectTo });
        return { data: {}, error: state.resetError };
      },
      getUser: async () => ({ data: { user: state.currentUser } }),
      updateUser: async (attrs: Record<string, unknown>) => {
        state.updateCalls.push(attrs);
        return { data: { user: state.currentUser }, error: state.updateError };
      },
    },
  };

  return { state, db, supabase };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  // No-op so actions run past redirect() and we can assert the target
  redirect: (path: string) => {
    h.state.redirectCalls.push(path);
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'origin' ? h.state.originHeader : null,
  }),
}));

function formData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.profileRows = [];
  h.state.resetCalls = [];
  h.state.resetError = null;
  h.state.currentUser = null;
  h.state.updateCalls = [];
  h.state.updateError = null;
  h.state.redirectCalls = [];
  h.state.originHeader = 'http://localhost:3000';
  h.state.baseUrl = undefined;
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

describe('requestPasswordReset', () => {
  it('sends a reset email for a known account and reports success', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]];

    const result = await requestPasswordReset(
      formData({ email: 'teacher@example.com' })
    );

    expect(h.state.resetCalls).toHaveLength(1);
    expect(h.state.resetCalls[0].email).toBe('teacher@example.com');
    expect(result).toEqual({ success: expect.stringContaining('reset link') });
    expect(result.error).toBeUndefined();
  });

  it('links back to the auth callback, which then forwards to /reset-password', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]];

    await requestPasswordReset(formData({ email: 'teacher@example.com' }));

    expect(h.state.resetCalls[0].redirectTo).toBe(
      'http://localhost:3000/auth/callback?next=/reset-password'
    );
  });

  it('trims whitespace from the submitted email', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]];

    await requestPasswordReset(formData({ email: '  teacher@example.com  ' }));

    expect(h.state.resetCalls[0].email).toBe('teacher@example.com');
  });

  it('returns the same success message for unknown emails (no account enumeration)', async () => {
    h.state.profileRows = [[]]; // no profile row

    const result = await requestPasswordReset(
      formData({ email: 'stranger@example.com' })
    );

    expect(h.state.resetCalls).toHaveLength(0);
    expect(result.success).toContain('reset link');
    expect(result.error).toBeUndefined();
  });

  it('does not send a reset email to ghost accounts (Supabase credentials without a profile row)', async () => {
    h.state.profileRows = [[]];

    await requestPasswordReset(formData({ email: 'ghost@example.com' }));

    expect(h.state.resetCalls).toHaveLength(0);
  });

  it('matches the profile lookup case-insensitively', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]]; // DB returns a row regardless

    await requestPasswordReset(formData({ email: 'Teacher@Example.com' }));

    expect(h.state.resetCalls).toHaveLength(1);
  });

  it('rejects a spoofed Origin header by falling back to the configured base URL', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]];
    h.state.originHeader = 'https://evil.example.com';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://olympiad-portal-eta.vercel.app';

    await requestPasswordReset(formData({ email: 'teacher@example.com' }));

    expect(h.state.resetCalls[0].redirectTo).toBe(
      'https://olympiad-portal-eta.vercel.app/auth/callback?next=/reset-password'
    );
  });

  it('uses the private LAN origin so reset links work from other devices (e.g. a phone)', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]];
    h.state.originHeader = 'http://10.100.4.41:3000';

    await requestPasswordReset(formData({ email: 'teacher@example.com' }));

    expect(h.state.resetCalls[0].redirectTo).toBe(
      'http://10.100.4.41:3000/auth/callback?next=/reset-password'
    );
  });

  it('uses the 192.168 LAN origin the same way', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]];
    h.state.originHeader = 'http://192.168.1.50:3000';

    await requestPasswordReset(formData({ email: 'teacher@example.com' }));

    expect(h.state.resetCalls[0].redirectTo).toBe(
      'http://192.168.1.50:3000/auth/callback?next=/reset-password'
    );
  });

  it('rejects public IP origins, falling back to the configured base URL', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]];
    h.state.originHeader = 'http://8.8.8.8:3000';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://olympiad-portal-eta.vercel.app';

    await requestPasswordReset(formData({ email: 'teacher@example.com' }));

    expect(h.state.resetCalls[0].redirectTo).toBe(
      'https://olympiad-portal-eta.vercel.app/auth/callback?next=/reset-password'
    );
  });

  it('falls back to the base URL when no Origin header is present', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]];
    h.state.originHeader = null;
    process.env.NEXT_PUBLIC_BASE_URL = 'https://olympiad-portal-eta.vercel.app';

    await requestPasswordReset(formData({ email: 'teacher@example.com' }));

    expect(h.state.resetCalls[0].redirectTo).toBe(
      'https://olympiad-portal-eta.vercel.app/auth/callback?next=/reset-password'
    );
  });

  it('returns a generic error when Supabase fails to send the email', async () => {
    h.state.profileRows = [[{ id: 'user-1' }]];
    h.state.resetError = { message: 'Rate limit exceeded' };

    const result = await requestPasswordReset(
      formData({ email: 'teacher@example.com' })
    );

    expect(result.error).toContain('Something went wrong');
    expect(result.success).toBeUndefined();
  });

  it('requires an email', async () => {
    const result = await requestPasswordReset(formData({ email: '' }));

    expect(result.error).toContain('email address');
    expect(h.state.resetCalls).toHaveLength(0);
  });
});

describe('resetPassword', () => {
  it('updates the password and redirects to the dashboard for a recovery session', async () => {
    h.state.currentUser = { id: 'user-1', email: 'teacher@example.com' };

    await resetPassword(
      formData({ password: 'new-password', confirmPassword: 'new-password' })
    );

    expect(h.state.updateCalls).toEqual([{ password: 'new-password' }]);
    expect(h.state.redirectCalls).toContain('/dashboard');
  });

  it('rejects passwords shorter than 6 characters', async () => {
    h.state.currentUser = { id: 'user-1', email: 'teacher@example.com' };

    const result = await resetPassword(
      formData({ password: '12345', confirmPassword: '12345' })
    );

    expect(result.error).toContain('at least 6 characters');
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.redirectCalls).toHaveLength(0);
  });

  it('rejects mismatched confirmation passwords', async () => {
    h.state.currentUser = { id: 'user-1', email: 'teacher@example.com' };

    const result = await resetPassword(
      formData({ password: 'new-password', confirmPassword: 'different' })
    );

    expect(result.error).toContain('do not match');
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.redirectCalls).toHaveLength(0);
  });

  it('rejects submissions without a session (expired or direct visit)', async () => {
    h.state.currentUser = null;

    const result = await resetPassword(
      formData({ password: 'new-password', confirmPassword: 'new-password' })
    );

    expect(result.error).toContain('invalid or has expired');
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.redirectCalls).toHaveLength(0);
  });

  it('surfaces Supabase update errors', async () => {
    h.state.currentUser = { id: 'user-1', email: 'teacher@example.com' };
    h.state.updateError = { message: 'New password should be different' };

    const result = await resetPassword(
      formData({ password: 'new-password', confirmPassword: 'new-password' })
    );

    expect(result.error).toBe('New password should be different');
    expect(h.state.redirectCalls).toHaveLength(0);
  });
});
