import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendInvitations } from '@/app/organiser/olympiads/[olympiadId]/invite/actions';

// Tests for the invite flow with the school picker: schools arrive as
// picked entries (name + type + external id), are find-or-created within
// the portal's scope, and educator memberships are de-duplicated per
// (portal, invited email) instead of crashing on the unique constraint.

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

type PickedFormSchool = {
  name: string;
  type?: string;
  externalId?: string;
  teacherEmails: string[];
};

function inviteForm(schools: PickedFormSchool[]): FormData {
  const fd = new FormData();
  fd.set('schoolCount', String(schools.length));
  schools.forEach((s, i) => {
    fd.set(`school_name_${i}`, s.name);
    if (s.type) fd.set(`school_type_${i}`, s.type);
    if (s.externalId) fd.set(`school_externalId_${i}`, s.externalId);
    for (const email of s.teacherEmails) {
      fd.append(`school_teacherEmails_${i}`, email);
    }
  });
  return fd;
}

const PICKED_HIGH_SCHOOL = {
  name: 'Springfield High',
  type: 'high_school',
  externalId: '700401012',
  teacherEmails: ['jonteacher@gmail.com'],
};

function formSchool(overrides: Partial<PickedFormSchool> = {}): PickedFormSchool {
  return { ...PICKED_HIGH_SCHOOL, ...overrides };
}

beforeEach(() => {
  h.state.userRows = [];
  h.state.txRows = [];
  h.state.txInserts = [];
  h.state.txUpdates = [];
  h.state.sentEmails = [];
});

describe('sendInvitations (picked schools)', () => {
  it('is a no-op when the educator is already an accepted member (regression: duplicate key crash)', async () => {
    h.state.userRows = [[{ id: 'user-jon', email: 'jonteacher@gmail.com' }]];
    h.state.txRows = [
      [{ id: 'school-1', name: 'Springfield High', type: 'high_school' }], // school lookup -> exists
      [
        {
          id: 'mem-jon',
          status: 'accepted',
          invitedEmail: 'jonteacher@gmail.com',
          inviteToken: 'old-token',
        },
      ], // membership lookup -> already a member
    ];

    const result = await sendInvitations('portal-1', inviteForm([formSchool()]));

    expect(result).toBeUndefined(); // no error object
    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.txUpdates).toHaveLength(0);
    expect(h.state.sentEmails).toHaveLength(0);
  });

  it('links and accepts a pending invite when the account now exists', async () => {
    h.state.userRows = [[{ id: 'user-2', email: 'jonteacher@gmail.com' }]];
    h.state.txRows = [
      [{ id: 'school-1', name: 'Springfield High', type: 'high_school' }],
      [
        {
          id: 'mem-2',
          status: 'invited',
          invitedEmail: 'jonteacher@gmail.com',
          inviteToken: 'tok-2',
        },
      ],
    ];

    await sendInvitations('portal-1', inviteForm([formSchool()]));

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
      [{ id: 'school-1', name: 'Springfield High', type: 'high_school' }],
      [
        {
          id: 'mem-3',
          status: 'invited',
          invitedEmail: 'jonteacher@gmail.com',
          inviteToken: 'tok-3',
        },
      ],
    ];

    await sendInvitations('portal-1', inviteForm([formSchool()]));

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
      [{ id: 'school-1', name: 'Springfield High', type: 'high_school' }],
      [], // no membership yet
    ];

    const form = inviteForm([
      formSchool({ teacherEmails: ['newteacher@gmail.com'] }),
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

  it('creates the school, a pending invite and sends the invite email for a brand-new school', async () => {
    h.state.userRows = [[]];
    h.state.txRows = [
      [], // school lookup misses -> insert
      [], // no membership yet
    ];

    const form = inviteForm([
      {
        name: 'New School',
        type: 'high_school',
        externalId: '999999999',
        teacherEmails: ['brandnew@teacher.com'],
      },
    ]);
    await sendInvitations('portal-1', form);

    expect(h.state.txInserts).toHaveLength(2);
    expect(h.state.txInserts[0]).toEqual({
      portalId: 'portal-1',
      name: 'New School',
      type: 'high_school',
      externalId: '999999999',
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

  it('stores universities with their domain as the external id', async () => {
    h.state.userRows = [[]];
    h.state.txRows = [
      [], // school lookup misses -> insert
      [], // no membership yet
    ];

    const form = inviteForm([
      {
        name: 'University of Cape Town',
        type: 'university',
        externalId: 'uct.ac.za',
        teacherEmails: ['lecturer@uct.ac.za'],
      },
    ]);
    await sendInvitations('portal-1', form);

    expect(h.state.txInserts[0]).toEqual({
      portalId: 'portal-1',
      name: 'University of Cape Town',
      type: 'university',
      externalId: 'uct.ac.za',
    });
  });

  it('heals a legacy type-less school row with the picked type and external id', async () => {
    h.state.userRows = [[]];
    h.state.txRows = [
      // School row created before the picker existed (type = NULL)
      [{ id: 'school-legacy', name: 'Springfield High', type: null }],
      [], // no membership yet
    ];

    await sendInvitations('portal-1', inviteForm([formSchool()]));

    // One update heals the school row; one insert creates the membership.
    expect(h.state.txUpdates).toEqual([
      { type: 'high_school', externalId: '700401012' },
    ]);
    expect(h.state.txInserts).toHaveLength(1);
    expect(h.state.txInserts[0]).toMatchObject({
      schoolId: 'school-legacy',
      status: 'invited',
    });
  });

  it('skips entries whose type is not a valid school type (tampered form data)', async () => {
    const form = inviteForm([
      { name: 'Weird School', type: 'kindergarten', teacherEmails: [] },
    ]);
    const result = await sendInvitations('portal-1', form);

    expect(result).toBeUndefined();
    expect(h.state.txInserts).toHaveLength(0);
    expect(h.state.txUpdates).toHaveLength(0);
    expect(h.state.sentEmails).toHaveLength(0);
  });
});
