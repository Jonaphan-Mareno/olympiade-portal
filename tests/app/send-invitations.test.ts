import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendInvitations } from '@/app/organiser/olympiads/[olympiadId]/invite/actions';

// Regression tests for the "duplicate key value violates unique constraint
// memberships_portal_id_invited_email_key" crash: re-inviting an email that
// already has a membership in the portal used to INSERT a second row and
// roll back the whole transaction.

// The action runs one users lookup, then a transaction whose queries are
// served from FIFO queues: every awaited select resolves to the next queued
// row array; inserts/updates are recorded for assertions.
const h = vi.hoisted(() => {
  const state = {
    userRows: [] as any[][],
    txRows: [] as any[][],
    txInserts: [] as any[],
    txUpdates: [] as any[],
    sentEmails: [] as any[],
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

  return { state, tx };
});

vi.mock('@/lib/db', () => ({
  db: {
    transaction: async (fn: (tx: any) => Promise<void>) => fn(h.tx),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(h.state.userRows.shift() ?? []),
      }),
    }),
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'organiser-user-1' } },
      }),
    },
  }),
}));

vi.mock('@/lib/email', () => ({
  sendInviteEmail: async (params: any) => {
    h.state.sentEmails.push(params);
    return {};
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

function inviteForm(
  schools: { existingId?: string; newName?: string; teacherEmails: string[] }[]
): FormData {
  const fd = new FormData();
  fd.set('schoolCount', String(schools.length));
  schools.forEach((s, i) => {
    if (s.existingId) fd.set(`school_existingId_${i}`, s.existingId);
    if (s.newName) fd.set(`school_newName_${i}`, s.newName);
    for (const email of s.teacherEmails) {
      fd.append(`school_teacherEmails_${i}`, email);
    }
  });
  return fd;
}

const EXISTING_SCHOOL = {
  existingId: 'school-1',
  teacherEmails: ['jonteacher@gmail.com'],
};

beforeEach(() => {
  h.state.userRows = [];
  h.state.txRows = [];
  h.state.txInserts = [];
  h.state.txUpdates = [];
  h.state.sentEmails = [];
});

describe('sendInvitations (re-invite handling)', () => {
  it('is a no-op when the educator is already an accepted member (regression: duplicate key crash)', async () => {
    h.state.userRows = [[{ id: 'user-jon', email: 'jonteacher@gmail.com' }]];
    h.state.txRows = [
      [{ name: 'Springfield High', portalId: 'portal-1' }], // school lookup
      [
        {
          id: 'mem-jon',
          status: 'accepted',
          invitedEmail: 'jonteacher@gmail.com',
          inviteToken: 'old-token',
        },
      ], // membership lookup -> already a member
    ];

    const result = await sendInvitations(
      'portal-1',
      inviteForm([EXISTING_SCHOOL])
    );

    expect(result).toBeUndefined(); // no error object
    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.txUpdates).toHaveLength(0);
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('links and accepts a pending invite when the account now exists', async () => {
    h.state.userRows = [[{ id: 'user-2', email: 'jonteacher@gmail.com' }]];
    h.state.txRows = [
      [{ name: 'Springfield High', portalId: 'portal-1' }],
      [
        {
          id: 'mem-2',
          status: 'invited',
          invitedEmail: 'jonteacher@gmail.com',
          inviteToken: 'tok-2',
        },
      ],
    ];

    await sendInvitations('portal-1', inviteForm([EXISTING_SCHOOL]));

    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.txUpdates).toHaveLength(1);
    expect(h.state.txUpdates[0]).toMatchObject({
      userId: 'user-2',
      schoolId: 'school-1',
      status: 'accepted',
      claimedAt: expect.any(Date),
    });
    // Has an account now — no invite email needed
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('re-sends the original invite token for a still-pending invite without an account', async () => {
    h.state.userRows = [[]]; // no account for this email
    h.state.txRows = [
      [{ name: 'Springfield High', portalId: 'portal-1' }],
      [
        {
          id: 'mem-3',
          status: 'invited',
          invitedEmail: 'jonteacher@gmail.com',
          inviteToken: 'tok-3',
        },
      ],
    ];

    await sendInvitations('portal-1', inviteForm([EXISTING_SCHOOL]));

    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.txUpdates).toHaveLength(1);
    expect(h.state.txUpdates[0]).toEqual({ schoolId: 'school-1' });
    expect(h.state.sentEmails).toHaveLength(1);
    expect(h.state.sentEmails[0]).toMatchObject({
      to: 'jonteacher@gmail.com',
      schoolName: 'Springfield High',
      inviteToken: 'tok-3', // the original token, still claimable at signup
    });
  });

  it('inserts an accepted membership for a fresh email that already has an account', async () => {
    h.state.userRows = [[{ id: 'user-9', email: 'newteacher@gmail.com' }]];
    h.state.txRows = [
      [{ name: 'Springfield High', portalId: 'portal-1' }],
      [], // no membership yet
    ];

    const form = inviteForm([
      { existingId: 'school-1', teacherEmails: ['newteacher@gmail.com'] },
    ]);
    await sendInvitations('portal-1', form);

    expect(h.state.txInserts).toHaveLength(1);
    expect(h.state.txInserts[0]).toMatchObject({
      userId: 'user-9',
      portalId: 'portal-1',
      schoolId: 'school-1',
      role: 'educator',
      status: 'accepted',
      invitedEmail: 'newteacher@gmail.com',
    });
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('creates the school, a pending invite and sends the invite email for a brand-new teacher', async () => {
    h.state.userRows = [[]];
    h.state.txRows = [
      [], // no membership yet
    ];

    const form = inviteForm([
      { newName: 'New School', teacherEmails: ['brandnew@teacher.com'] },
    ]);
    await sendInvitations('portal-1', form);

    expect(h.state.txInserts).toHaveLength(2);
    expect(h.state.txInserts[0]).toEqual({
      portalId: 'portal-1',
      name: 'New School',
    });
    expect(h.state.txInserts[1]).toMatchObject({
      portalId: 'portal-1',
      schoolId: 'inserted-row',
      role: 'educator',
      status: 'invited',
      invitedEmail: 'brandnew@teacher.com',
    });
    expect(h.state.sentEmails).toHaveLength(1);
    expect(h.state.sentEmails[0]).toMatchObject({
      to: 'brandnew@teacher.com',
      schoolName: 'New School',
      inviteToken: 'fresh-token',
    });
  });

  it('rejects an existing school that belongs to a different portal (regression: cross-portal leak)', async () => {
    h.state.userRows = [[{ id: 'user-jon', email: 'jonteacher@gmail.com' }]];
    h.state.txRows = [
      // The school row exists but belongs to another olympiad
      [{ name: 'Random School', portalId: 'portal-OTHER' }],
    ];

    const result = await sendInvitations(
      'portal-1',
      inviteForm([EXISTING_SCHOOL])
    );

    expect(result).toMatchObject({
      error: expect.stringContaining('does not belong to this olympiad'),
    });
    // Nothing was written — no school, no memberships, no emails
    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.txUpdates).toHaveLength(0);
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('rejects a nonexistent existing school id the same way', async () => {
    h.state.userRows = [[{ id: 'user-jon', email: 'jonteacher@gmail.com' }]];
    h.state.txRows = [[]]; // school lookup misses

    const result = await sendInvitations(
      'portal-1',
      inviteForm([EXISTING_SCHOOL])
    );

    expect(result).toMatchObject({
      error: expect.stringContaining('does not belong to this olympiad'),
    });
    expect(h.state.txInserts).toHaveLength(0);
  });
});
