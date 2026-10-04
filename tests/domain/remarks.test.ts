import { describe, it, expect, vi, beforeEach } from 'vitest';

// Queries run in a fixed order, so selects are served from a FIFO queue.
// Updates are recorded; `.returning()` yields state.returning.
const state = vi.hoisted(() => ({
  queue: [] as any[][],
  updates: [] as any[],
  returning: [{ id: 'remark-1' }] as any[],
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
    update: () => ({
      set: (values: any) => ({
        where: () => {
          state.updates.push(values);
          const p: any = Promise.resolve();
          p.returning = () => Promise.resolve(state.returning);
          return p;
        },
      }),
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  },
}));

vi.mock('@/domain/rounds/advance-entrants', () => ({
  advanceQualifyingEntrants: vi.fn(async () => null),
}));
vi.mock('@/domain/notifications/in-app-notifications', () => ({
  notifyEducatorsInPortal: vi.fn(async () => {}),
}));

import {
  getRemarkEligibility,
  resolveRemarkRequest,
  REMARK_WINDOW_DAYS,
} from '@/domain/remarks/remarks';
import { advanceQualifyingEntrants } from '@/domain/rounds/advance-entrants';

const DAY = 24 * 60 * 60 * 1000;
const published = new Date('2026-09-01T10:00:00Z');

describe('getRemarkEligibility', () => {
  const base = { resultsPublishedAt: published, hasScore: true, hasExistingRequest: false };

  it('allows an appeal within the window after publication', () => {
    const e = getRemarkEligibility(base, new Date(published.getTime() + 3 * DAY));
    expect(e.eligible).toBe(true);
  });

  it('closes the window after REMARK_WINDOW_DAYS', () => {
    const e = getRemarkEligibility(
      base,
      new Date(published.getTime() + (REMARK_WINDOW_DAYS + 1) * DAY)
    );
    expect(e.eligible).toBe(false);
  });

  it('requires published results, a mark, and no earlier appeal', () => {
    const now = new Date(published.getTime() + DAY);
    expect(getRemarkEligibility({ ...base, resultsPublishedAt: null }, now).eligible).toBe(false);
    expect(getRemarkEligibility({ ...base, hasScore: false }, now).eligible).toBe(false);
    expect(getRemarkEligibility({ ...base, hasExistingRequest: true }, now).eligible).toBe(false);
  });
});

describe('resolveRemarkRequest', () => {
  const request = {
    id: 'remark-1',
    submissionId: 'sub-1',
    reason: 'Q1 was right',
    status: 'pending',
    previousScore: '2',
    currentScore: '2',
    roundId: 'round-1',
    roundName: 'Round 1',
    portalId: 'portal-1',
    submissionType: 'online',
    studentMembershipId: 'stu-1',
    studentSchoolId: 'school-1',
  };
  const question = (id: string, marks: number) => ({
    id,
    prompt: `Prompt ${id}`,
    questionType: 'single_choice',
    marks,
    correctAnswer: 'A',
    options: ['A', 'B'],
  });

  function queueOnline() {
    state.queue = [
      [request], // getRemarkRequest
      [{ ownerUserId: 'organiser' }], // canResolveRemark: portal owner
      [{ roundId: 'round-1', studentMembershipId: 'stu-1', answersJson: { q1: 'B', q2: 'A' } }],
      [question('q1', 4), question('q2', 2)], // round questions
      [], // existing remark marks
      [], // educator marks
      [{ resultsPublishedAt: published }], // round lookup for advancement
    ];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.updates = [];
    state.returning = [{ id: 'remark-1' }];
  });

  it('writes the remarked total to the result and re-runs advancement', async () => {
    queueOnline();

    const res = await resolveRemarkRequest('organiser', {
      requestId: 'remark-1',
      note: 'Q1 accepted.',
      questionMarks: { q1: 4 }, // q2 keeps its current 2 marks
    });

    expect(res).toEqual({ newScore: 6 });
    expect(state.updates[0]).toMatchObject({
      status: 'resolved',
      newScore: '6',
      questionMarks: { q1: 4, q2: 2 },
      responseNote: 'Q1 accepted.',
    });
    expect(state.updates[1]).toMatchObject({
      score: '6',
      status: 'remark_resolved',
      remarkOutcome: 'Mark changed from 2 to 6. Q1 accepted.',
    });
    expect(advanceQualifyingEntrants).toHaveBeenCalledWith('round-1');
  });

  it('rejects marks above a question maximum', async () => {
    queueOnline();

    const res = await resolveRemarkRequest('organiser', {
      requestId: 'remark-1',
      note: 'x',
      questionMarks: { q1: 5 },
    });

    expect(res.error).toContain('Question 1');
    expect(state.updates).toHaveLength(0);
  });

  it('refuses users who are neither the organiser nor the school educator', async () => {
    state.queue = [[request], [{ ownerUserId: 'organiser' }], []];

    const res = await resolveRemarkRequest('someone-else', {
      requestId: 'remark-1',
      note: 'x',
    });

    expect(res.error).toMatch(/not allowed/);
    expect(state.updates).toHaveLength(0);
  });

  it('takes a new total for paper rounds', async () => {
    state.queue = [
      [{ ...request, submissionType: 'offline' }],
      [{ ownerUserId: 'organiser' }],
      [{ resultsPublishedAt: null }],
    ];

    const res = await resolveRemarkRequest('organiser', {
      requestId: 'remark-1',
      note: 'Re-added page 3.',
      newTotal: 7.5,
    });

    expect(res).toEqual({ newScore: 7.5 });
    expect(state.updates[1]).toMatchObject({ score: '7.5' });
    expect(advanceQualifyingEntrants).not.toHaveBeenCalled();
  });
});
