import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, signup } from '@/app/auth/actions';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

// Regression tests: a teacher invited to several olympiads before creating an
// account used to claim only the invite whose link they clicked — their other
// memberships stayed 'invited' with no user forever. signup() and login() now
// auto-accept every pending invite addressed to the account's email.

const dialect = new PgDialect();

interface CapturedUpdate {
  set: Record<string, unknown>;
  whereSql: string;
  whereParams: unknown[];
}

const h = vi.hoisted(() => {
  const state = {
    // Queued row arrays, one per select() the action performs
    selectRows: [] as any[][],
    capturedInserts: [] as any[],
    capturedUpdates: [] as CapturedUpdate[],
    redirectCalls: [] as string[],
    supabaseUser: null as { id: string; email: string } | null,
    signUpResult: null as { id: string; email: string } | null,
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.selectRows.shift() ?? []),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        state.capturedInserts.push(v);
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (w: SQL) => {
          const q = dialect.sqlToQuery(w);
          state.capturedUpdates.push({
            set: v,
            whereSql: q.sql,
            whereParams: q.params,
          });
          return Promise.resolve();
        },
      }),
    }),
  };

  const supabase = {
    auth: {
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({
        data: { user: state.supabaseUser },
        error: null,
      }),
      getUser: async () => ({ data: { user: state.supabaseUser } }),
      signOut: async () => ({}),
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

function formData(entries: Record<string, string | null>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v !== null) fd.set(k, v);
  }
  return fd;
}

beforeEach(() => {
  h.state.selectRows = [];
  h.state.capturedInserts = [];
  h.state.capturedUpdates = [];
  h.state.redirectCalls = [];
  h.state.supabaseUser = null;
});

describe('signup: auto-claims all pending invites for the email', () => {
  it('claims the clicked token AND auto-accepts other pending invites (multi-olympiad teacher)', async () => {
    h.state.supabaseUser = { id: 'user-new', email: 'jonteacher@gmail.com' };
    // The token lookup finds the invite whose link was clicked (olympiad A)
    h.state.selectRows = [
      [
        {
          id: 'mem-token',
          role: 'educator',
          portalId: 'portal-A',
          invitedEmail: 'jonteacher@gmail.com',
        },
      ],
    ];

    await signup(
      formData({
        email: 'jonteacher@gmail.com',
        password: 'pw123456',
        name: 'Jon Teacher',
        inviteToken: 'tok-A',
      })
    );

    // Public profile row created
    expect(h.state.capturedInserts).toHaveLength(1);
    expect(h.state.capturedInserts[0]).toMatchObject({
      id: 'user-new',
      email: 'jonteacher@gmail.com',
    });

    // Token claim targets the clicked membership
    expect(h.state.capturedUpdates).toHaveLength(2);
    expect(h.state.capturedUpdates[0]).toMatchObject({
      set: { userId: 'user-new', status: 'accepted' },
    });
    expect(h.state.capturedUpdates[0].whereParams).toContain('mem-token');

    // Auto-link sweep targets the EMAIL, not a single row, so memberships in
    // olympiads B, C, ... are accepted by the same UPDATE
    const autoLink = h.state.capturedUpdates[1];
    expect(autoLink.set).toMatchObject({
      userId: 'user-new',
      status: 'accepted',
      claimedAt: expect.any(Date),
    });
    expect(autoLink.whereSql).toContain('"memberships"."invited_email"');
    expect(autoLink.whereSql).toContain('"memberships"."status"');
    expect(autoLink.whereParams).toContain('jonteacher@gmail.com');
    expect(autoLink.whereParams).toContain('invited');

    // New accounts are welcomed first, carrying the invite's dashboard as
    // the next destination (encoded as a query param)
    expect(h.state.redirectCalls).toContain(
      `/welcome?next=${encodeURIComponent('/educator/dashboard?portalId=portal-A')}`
    );
  });

  it('lowercases the email when matching pending invites (invite stored lowercase)', async () => {
    h.state.supabaseUser = { id: 'user-new', email: 'jon@teacher.com' };
    h.state.selectRows = [[]]; // token lookup misses

    await signup(
      formData({
        email: 'Jon@Teacher.com',
        password: 'pw123456',
        name: 'Jon',
        inviteToken: 'unknown-token',
      })
    );

    expect(h.state.capturedUpdates).toHaveLength(1);
    expect(h.state.capturedUpdates[0].whereParams).toContain('jon@teacher.com');
    expect(h.state.redirectCalls).toContain(
      `/welcome?next=${encodeURIComponent('/dashboard')}`
    );
  });

  it('auto-accepts pending invites even when signing up with no invite link at all', async () => {
    h.state.supabaseUser = { id: 'user-new', email: 'solo@teacher.com' };
    h.state.selectRows = []; // no token => no lookup

    await signup(
      formData({
        email: 'solo@teacher.com',
        password: 'pw123456',
        name: 'Solo',
        inviteToken: null,
      })
    );

    expect(h.state.capturedUpdates).toHaveLength(1);
    expect(h.state.capturedUpdates[0].whereParams).toContain(
      'solo@teacher.com'
    );
    expect(h.state.capturedUpdates[0].whereParams).toContain('invited');
  });
});

describe('login: auto-claims invites for users who signed up without a link', () => {
  it('accepts pending invites addressed to the logged-in email', async () => {
    h.state.supabaseUser = { id: 'user-9', email: 'late@teacher.com' };
    h.state.selectRows = [[{ id: 'user-9' }]]; // profile exists

    await login(formData({ email: 'late@teacher.com', password: 'pw123456' }));

    expect(h.state.capturedUpdates).toHaveLength(1);
    const sweep = h.state.capturedUpdates[0];
    expect(sweep.set).toMatchObject({
      userId: 'user-9',
      status: 'accepted',
      claimedAt: expect.any(Date),
    });
    expect(sweep.whereSql).toContain('"memberships"."invited_email"');
    expect(sweep.whereSql).toContain('"memberships"."status"');
    expect(sweep.whereParams).toContain('late@teacher.com');
    expect(sweep.whereParams).toContain('invited');
    expect(h.state.redirectCalls).toContain('/dashboard');
  });

  it('does not touch memberships when the account is a ghost (no profile row)', async () => {
    h.state.supabaseUser = { id: 'ghost', email: 'ghost@teacher.com' };
    h.state.selectRows = [[]]; // profile lookup misses

    const result = await login(
      formData({ email: 'ghost@teacher.com', password: 'pw123456' })
    );

    expect(result).toMatchObject({
      error: expect.stringContaining('no longer exists'),
    });
    expect(h.state.capturedUpdates).toHaveLength(0);
    expect(h.state.redirectCalls).toHaveLength(0);
  });
});
