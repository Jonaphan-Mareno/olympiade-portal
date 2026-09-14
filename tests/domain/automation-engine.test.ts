import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Round } from '@/domain/rounds/round.types';
import {
  sendRoundOpeningReminders,
  sendRoundClosingReminders,
  sendSubmissionOverdueFollowups,
  sendResultsPublishedNotifications,
} from '@/domain/notifications/automation-engine';

// The engine's DB queries run in a fixed order, so the mock serves results
// from a FIFO queue: every `.where()` (i.e. every awaited query) shifts the
// next result. Inserts/updates are recorded for assertions.
const state = vi.hoisted(() => ({
  queue: [] as any[][],
  inserts: [] as any[],
  updates: [] as any[],
  sentEmails: [] as Array<{ to: string; subject: string; html: string }>,
  sendEmailError: null as Error | null,
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => {
        const chain: any = {
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: () => Promise.resolve(state.queue.shift() ?? []),
        };
        return chain;
      },
    }),
    insert: () => ({
      values: (v: any) => ({
        onConflictDoNothing: () => {
          state.inserts.push(v);
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => {
          state.updates.push(v);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(
    async (params: { to: string; subject: string; html: string }) => {
      if (state.sendEmailError) throw state.sendEmailError;
      state.sentEmails.push(params);
      return { previewUrl: undefined };
    }
  ),
}));

const round: Round = {
  id: 'round-1',
  portalId: 'portal-1',
  portalName: 'Maths Olympiad',
  name: 'Round 1',
  orderIndex: 1,
  deliveryMethod: 'paper',
  opensAt: new Date('2026-09-01T09:00:00Z'),
  closesAt: new Date('2026-09-10T17:00:00Z'),
  qualifyingThreshold: '30',
  resultsPublishedAt: null,
};

beforeEach(() => {
  state.queue = [];
  state.inserts = [];
  state.updates = [];
  state.sentEmails = [];
  state.sendEmailError = null;
  process.env.NEXT_PUBLIC_BASE_URL = 'http://test.example';
});

describe('sendRoundOpeningReminders', () => {
  const educators = [
    {
      membershipId: 'edu-1',
      invitedEmail: 'claimed@springfield.edu',
      userEmail: 'real@springfield.edu',
      schoolId: 'school-1',
      schoolName: 'Springfield High',
      name: 'Mrs Krabappel',
    },
    {
      membershipId: 'edu-2',
      invitedEmail: 'invited@shelbyville.edu',
      userEmail: null,
      schoolId: 'school-2',
      schoolName: 'Shelbyville High',
      name: null,
    },
  ];

  it('emails every educator, preferring the claimed account address', async () => {
    state.queue = [educators, [], []]; // educators, log lookup x2

    const summary = await sendRoundOpeningReminders(round);

    expect(summary).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(state.sentEmails.map((e) => e.to)).toEqual([
      'real@springfield.edu',
      'invited@shelbyville.edu',
    ]);
    expect(state.sentEmails[0].subject).toContain('Round 1');
    expect(state.sentEmails[0].html).toContain('Maths Olympiad');
    expect(state.sentEmails[0].html).toContain(
      'http://test.example/educator/dashboard?portalId=portal-1'
    );

    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[0]).toMatchObject({
      kind: 'round_opening_reminder',
      roundId: 'round-1',
      recipientMembershipId: 'edu-1',
      recipientEmail: 'real@springfield.edu',
      schoolId: 'school-1',
    });
    expect(state.updates[0].status).toBe('sent');
  });

  it('skips recipients whose email was already sent (idempotency)', async () => {
    state.queue = [educators, [{ status: 'sent' }], [{ status: 'sent' }]];

    const summary = await sendRoundOpeningReminders(round);

    expect(summary).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(state.sentEmails).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it('marks failed sends so the next sweep retries them', async () => {
    const loneEducator = [educators[0]];
    state.sendEmailError = new Error('SMTP down');
    state.queue = [loneEducator, []];

    const failed = await sendRoundOpeningReminders(round);

    expect(failed).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(state.inserts[0].status).toBe('failed');
    expect(state.updates[0].status).toBe('failed');

    // Next sweep: the log row exists with status 'failed' -> send retried
    state.sendEmailError = null;
    state.queue = [loneEducator, [{ status: 'failed' }]];

    const retried = await sendRoundOpeningReminders(round);

    expect(retried).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(state.sentEmails).toHaveLength(1);
    // No duplicate log row: the failed one is updated instead
    expect(state.inserts).toHaveLength(1);
    expect(state.updates[1].status).toBe('sent');
  });
});

describe('sendRoundClosingReminders', () => {
  it('includes per-school submission progress and days left', async () => {
    state.queue = [
      [
        {
          membershipId: 'edu-1',
          invitedEmail: 'a@springfield.edu',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
        },
      ],
      [
        {
          membershipId: 'stu-1',
          invitedEmail: 'lisa@example.com',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
          name: 'Lisa Simpson',
        },
        {
          membershipId: 'stu-2',
          invitedEmail: 'milhouse@example.com',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
          name: 'Milhouse',
        },
      ],
      [{ studentMembershipId: 'stu-1' }],
      [], // log lookup
    ];

    const summary = await sendRoundClosingReminders(
      round,
      new Date('2026-09-09T12:00:00Z')
    );

    expect(summary).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(state.sentEmails).toHaveLength(1);
    expect(state.sentEmails[0].html).toContain('1 of 2');
    expect(state.sentEmails[0].subject).toContain('closes');
    // 29 hours remain — days take precedence, so it reads "1 day" not "5 hours"
    expect(state.sentEmails[0].html).toContain('closes in 1 day');
    expect(state.inserts[0].kind).toBe('round_closing_reminder');
  });

  it('describes the deadline in hours when it is under a day away', async () => {
    state.queue = [
      [
        {
          membershipId: 'edu-1',
          invitedEmail: 'a@springfield.edu',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
        },
      ],
      [], // entrants
      [], // submissions
      [], // log lookup
    ];

    // 90 minutes before the deadline
    const summary = await sendRoundClosingReminders(
      round,
      new Date('2026-09-10T15:30:00Z')
    );

    expect(summary).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(state.sentEmails[0].html).toContain('closes in about 1 hour');
  });
});

describe('sendSubmissionOverdueFollowups', () => {
  it('chases only educators whose school still has missing submissions', async () => {
    state.queue = [
      [
        {
          membershipId: 'edu-1',
          invitedEmail: 'a@springfield.edu',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
        },
        {
          membershipId: 'edu-2',
          invitedEmail: 'b@shelbyville.edu',
          schoolId: 'school-2',
          schoolName: 'Shelbyville High',
        },
      ],
      [
        {
          membershipId: 'stu-1',
          invitedEmail: 'lisa@example.com',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
          name: 'Lisa Simpson',
        },
        {
          membershipId: 'stu-2',
          invitedEmail: 'milhouse@example.com',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
          name: 'Milhouse Van Houten',
        },
        {
          membershipId: 'stu-3',
          invitedEmail: 'rod@example.com',
          schoolId: 'school-2',
          schoolName: 'Shelbyville High',
          name: 'Rod Flanders',
        },
      ],
      // Lisa and Rod submitted; Milhouse did not -> only Springfield is chased
      [{ studentMembershipId: 'stu-1' }, { studentMembershipId: 'stu-3' }],
      [], // log lookup for edu-1
    ];

    const summary = await sendSubmissionOverdueFollowups(round);

    expect(summary).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(state.sentEmails).toHaveLength(1);
    expect(state.sentEmails[0].to).toBe('a@springfield.edu');
    expect(state.sentEmails[0].subject).toContain('Missing submissions');
    expect(state.sentEmails[0].html).toContain('<strong>1</strong> submission');
    expect(state.sentEmails[0].html).toContain('Milhouse Van Houten');
    expect(state.sentEmails[0].html).not.toContain('Lisa Simpson');
    expect(state.inserts[0].kind).toBe('submission_overdue_followup');
  });

  it('sends nothing when every school has submitted everything', async () => {
    state.queue = [
      [
        {
          membershipId: 'edu-1',
          invitedEmail: 'a@springfield.edu',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
        },
      ],
      [
        {
          membershipId: 'stu-1',
          invitedEmail: 'lisa@example.com',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
          name: 'Lisa Simpson',
        },
      ],
      [{ studentMembershipId: 'stu-1' }],
    ];

    const summary = await sendSubmissionOverdueFollowups(round);

    expect(summary).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(state.sentEmails).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });
});

describe('sendResultsPublishedNotifications', () => {
  it('emails educators a school summary and entrants their own result', async () => {
    state.queue = [
      [
        {
          membershipId: 'edu-1',
          invitedEmail: 'a@springfield.edu',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
        },
        // Educator of a school with no entrants gets no email
        {
          membershipId: 'edu-2',
          invitedEmail: 'b@empty.edu',
          schoolId: 'school-9',
          schoolName: 'Empty High',
        },
      ],
      [
        {
          membershipId: 'stu-1',
          invitedEmail: 'lisa@example.com',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
          name: 'Lisa Simpson',
        },
        // Did not submit -> no own-result email
        {
          membershipId: 'stu-2',
          invitedEmail: 'milhouse@example.com',
          schoolId: 'school-1',
          schoolName: 'Springfield High',
          name: 'Milhouse',
        },
      ],
      [{ studentMembershipId: 'stu-1' }],
      // dispatch() log lookup for the educator summary email
      [],
      [
        {
          submissionId: 'sub-1',
          studentMembershipId: 'stu-1',
          score: '42',
          feedback: 'Excellent work',
        },
      ],
      // dispatch() log lookup for the entrant own-result email
      [],
    ];

    const summary = await sendResultsPublishedNotifications(round);

    expect(summary).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(state.sentEmails).toHaveLength(2);

    // Educator summary first
    expect(state.sentEmails[0].to).toBe('a@springfield.edu');
    expect(state.sentEmails[0].subject).toBe('Results are out: Round 1');
    expect(state.sentEmails[0].html).toContain('<strong>1</strong> submission');
    expect(state.sentEmails[0].html).toContain('<strong>2</strong> entrants');
    expect(state.sentEmails[0].html).toContain(
      'http://test.example/results/portal-1'
    );

    // Entrant own result second
    expect(state.sentEmails[1].to).toBe('lisa@example.com');
    expect(state.sentEmails[1].subject).toContain('Your result for Round 1');
    expect(state.sentEmails[1].html).toContain('Lisa Simpson');
    expect(state.sentEmails[1].html).toContain('<strong>42</strong>');
    expect(state.sentEmails[1].html).toContain('Excellent work');
    // Milhouse did not submit -> never named in any email
    expect(state.sentEmails.map((e) => e.html).join('')).not.toContain(
      'milhouse@example.com'
    );

    expect(state.inserts.map((i) => i.kind)).toEqual([
      'results_published_school',
      'results_published_entrant',
    ]);
  });
});
