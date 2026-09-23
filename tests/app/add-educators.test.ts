import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addEducators } from '@/app/organiser/olympiads/[olympiadId]/actions';

// Tests for the per-school "Add Educator" action on the olympiad detail
// page: it must attach educators to an EXISTING school row (keyed by id, so
// schools that can no longer be re-picked from the directories still work),
// reuse the same (portal, invited email) dedup semantics as the invite flow,
// and refuse school ids that do not belong to the olympiad.

// The action runs three lookups off db.select (school, portal name, existing
// users) served from a FIFO queue, then a transaction whose queries are also
// served from FIFO queues; inserts/updates are recorded for assertions.
const h = vi.hoisted(() => {
  const state = {
    authUser: null as { id: string } | null,
    dbRows: [] as any[][],
    txRows: [] as any[][],
    txInserts: [] as any[],
    txUpdates: [] as any[],
    sentEmails: [] as any[],
    revalidated: [] as string[],
  };

  const tx = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.txRows.shift() ?? []),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        state.txInserts.push(v);
        return {
          returning: () =>
            Promise.resolve([
              { ...v, id: 'inserted-row', inviteToken: 'fresh-token' },
            ]),
          onConflictDoNothing: () => Promise.resolve(),
        };
      },
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => {
          state.txUpdates.push(v);
          return Promise.resolve();
        },
      }),
    }),
  };

  const db = {
    transaction: async (fn: (tx: any) => Promise<void>) => fn(tx),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.dbRows.shift() ?? []),
      }),
    }),
  };

  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: state.authUser } }),
    },
  };

  return { state, db, supabase };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));
vi.mock('@/lib/email', () => ({
  sendInviteEmail: async (params: any) => {
    h.state.sentEmails.push(params);
    return {};
  },
}));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    h.state.revalidated.push(path);
  },
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const SCHOOL_ROW = [{ id: 'school-1', name: 'Springfield High' }];
const PORTAL_ROW = [{ name: 'National Maths Olympiad' }];

function educatorForm(emails: string[]): FormData {
  const fd = new FormData();
  emails.forEach((e) => fd.append('teacherEmails', e));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.authUser = { id: 'organiser-user-1' };
  h.state.dbRows = [];
  h.state.txRows = [];
  h.state.txInserts = [];
  h.state.txUpdates = [];
  h.state.sentEmails = [];
  h.state.revalidated = [];
});

describe('addEducators (existing school)', () => {
  it('creates a pending invite and emails it for a fresh email address', async () => {
    h.state.dbRows = [
      SCHOOL_ROW, // school lookup -> belongs to the portal
      PORTAL_ROW, // portal name for the email
      [], // users lookup -> no account yet
    ];
    h.state.txRows = [[]]; // membership lookup -> none

    const result = await addEducators(
      'portal-1',
      'school-1',
      educatorForm(['newteacher@gmail.com'])
    );

    expect(result).toBeUndefined(); // no error object
    expect(h.state.txInserts).toHaveLength(1);
    expect(h.state.txInserts[0]).toMatchObject({
      portalId: 'portal-1',
      schoolId: 'school-1',
      role: 'educator',
      status: 'invited',
      invitedEmail: 'newteacher@gmail.com',
    });
    expect(h.state.sentEmails).toHaveLength(1);
    expect(h.state.sentEmails[0]).toMatchObject({
      to: 'newteacher@gmail.com',
      portalName: 'National Maths Olympiad',
      schoolName: 'Springfield High',
      inviteToken: 'fresh-token',
    });
    expect(h.state.revalidated).toContain('/organiser/olympiads/portal-1');
  });

  it('links an existing account directly without emailing', async () => {
    h.state.dbRows = [
      SCHOOL_ROW,
      PORTAL_ROW,
      [{ id: 'user-9', email: 'newteacher@gmail.com' }], // account exists
    ];
    h.state.txRows = [[]]; // no membership yet

    await addEducators(
      'portal-1',
      'school-1',
      educatorForm(['newteacher@gmail.com'])
    );

    expect(h.state.txInserts).toHaveLength(1);
    expect(h.state.txInserts[0]).toMatchObject({
      userId: 'user-9',
      schoolId: 'school-1',
      status: 'accepted',
    });
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('is a no-op when the educator is already an accepted member', async () => {
    h.state.dbRows = [SCHOOL_ROW, PORTAL_ROW, []];
    h.state.txRows = [
      [
        {
          id: 'mem-jon',
          status: 'accepted',
          invitedEmail: 'jonteacher@gmail.com',
          inviteToken: 'old-token',
        },
      ], // membership lookup -> already a member
    ];

    const result = await addEducators(
      'portal-1',
      'school-1',
      educatorForm(['jonteacher@gmail.com'])
    );

    expect(result).toBeUndefined();
    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.txUpdates).toHaveLength(0);
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('re-sends the original token for a still-pending invite without an account', async () => {
    h.state.dbRows = [SCHOOL_ROW, PORTAL_ROW, []];
    h.state.txRows = [
      [
        {
          id: 'mem-3',
          status: 'invited',
          invitedEmail: 'jonteacher@gmail.com',
          inviteToken: 'tok-3',
        },
      ],
    ];

    await addEducators(
      'portal-1',
      'school-1',
      educatorForm(['jonteacher@gmail.com'])
    );

    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.txUpdates).toEqual([{ schoolId: 'school-1' }]);
    expect(h.state.sentEmails).toHaveLength(1);
    expect(h.state.sentEmails[0]).toMatchObject({
      to: 'jonteacher@gmail.com',
      inviteToken: 'tok-3',
    });
  });

  it('links and accepts a pending invite when the account now exists', async () => {
    h.state.dbRows = [
      SCHOOL_ROW,
      PORTAL_ROW,
      [{ id: 'user-2', email: 'jonteacher@gmail.com' }],
    ];
    h.state.txRows = [
      [
        {
          id: 'mem-2',
          status: 'invited',
          invitedEmail: 'jonteacher@gmail.com',
          inviteToken: 'tok-2',
        },
      ],
    ];

    await addEducators(
      'portal-1',
      'school-1',
      educatorForm(['jonteacher@gmail.com'])
    );

    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.txUpdates).toHaveLength(1);
    expect(h.state.txUpdates[0]).toMatchObject({
      userId: 'user-2',
      schoolId: 'school-1',
      status: 'accepted',
      claimedAt: expect.any(Date),
    });
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('invites each address once even when the form repeats it', async () => {
    h.state.dbRows = [SCHOOL_ROW, PORTAL_ROW, []];
    h.state.txRows = [[]]; // a single membership lookup

    await addEducators(
      'portal-1',
      'school-1',
      educatorForm(['Tea@cher.com', 'tea@cher.com', 'tea@cher.com'])
    );

    expect(h.state.txInserts).toHaveLength(1);
    expect(h.state.txInserts[0]).toMatchObject({
      invitedEmail: 'tea@cher.com', // lowercased too
    });
  });

  it('refuses a school id that is not part of the olympiad', async () => {
    h.state.dbRows = [[]]; // school lookup misses

    const result = await addEducators(
      'portal-1',
      'some-other-school',
      educatorForm(['newteacher@gmail.com'])
    );

    expect(result).toEqual({
      error: 'This school is not part of the olympiad.',
    });
    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('rejects entries with no valid email address', async () => {
    const result = await addEducators(
      'portal-1',
      'school-1',
      educatorForm(['not-an-email', '   '])
    );

    expect(result).toEqual({
      error: 'Enter at least one valid educator email address.',
    });
    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('requires a signed-in user', async () => {
    h.state.authUser = null;

    const result = await addEducators(
      'portal-1',
      'school-1',
      educatorForm(['newteacher@gmail.com'])
    );

    expect(result).toEqual({
      error: 'You must be signed in to add educators.',
    });
    expect(h.state.txInserts).toHaveLength(0);
  });
});
