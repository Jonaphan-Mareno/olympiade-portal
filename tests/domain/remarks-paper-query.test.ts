import { describe, it, expect, vi, beforeEach } from 'vitest';

// createRemarkRequest (paper-script query, up to two attempts) and
// withdrawRemarkRequest. Selects come from a FIFO queue; inserted remarks and
// updates are recorded so we can assert exactly what was stored.
const state = vi.hoisted(() => ({
  queue: [] as any[][],
  selects: 0,
  inserted: [] as any[],
  updates: [] as any[],
  // What the next conditional UPDATE ... RETURNING yields
  returning: [{ id: 'remark-1' }] as any[],
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => {
        const chain: any = {
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: () => {
            state.selects += 1;
            return Promise.resolve(state.queue.shift() ?? []);
          },
        };
        return chain;
      },
    }),
    insert: () => ({
      values: (v: any) => {
        state.inserted.push(v);
        return {
          onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: 'remark-1' }]) }),
        };
      },
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => {
          state.updates.push(v);
          const p: any = Promise.resolve();
          p.returning = () => Promise.resolve(state.returning);
          return p;
        },
      }),
    }),
  },
}));

vi.mock('@/domain/question-bank/load-variant', () => ({
  loadSittingQuestions: vi.fn(async () => []),
}));
vi.mock('@/domain/rounds/advance-entrants', () => ({
  advanceQualifyingEntrants: vi.fn(async () => null),
}));
vi.mock('@/domain/notifications/in-app-notifications', () => ({
  notifyEducatorsInPortal: vi.fn(async () => {}),
}));

import { createRemarkRequest, withdrawRemarkRequest } from '@/domain/remarks/remarks';

const DAY = 24 * 60 * 60 * 1000;
const published = new Date('2026-09-01T10:00:00Z');
const now = new Date(published.getTime() + 2 * DAY);

const row = (submissionType: 'online' | 'offline') => ({
  score: '12',
  resultsPublishedAt: published,
  portalId: 'portal-1',
  roundName: 'Round 1',
  schoolId: 'school-1',
  submissionType,
});
// Queue order: the submission row, earlier attempts, [page count], educators
const NO_ATTEMPTS: any[] = [];

beforeEach(() => {
  state.queue = [];
  state.selects = 0;
  state.inserted = [];
  state.updates = [];
  state.returning = [{ id: 'remark-1' }];
});

describe('createRemarkRequest — online appeals are unchanged', () => {
  it('stores the reason only, as attempt 1', async () => {
    state.queue = [[row('online')], NO_ATTEMPTS, [] /* school educators to notify */];

    const res = await createRemarkRequest('entrant', 'sub-1', '  Q4 matches the memo ', {}, now);

    expect(res).toEqual({});
    expect(state.inserted[0]).toMatchObject({
      submissionId: 'sub-1',
      attempt: 1,
      reason: 'Q4 matches the memo',
      questionRefs: null,
      pins: null,
      previousScore: '12',
    });
    expect(state.updates[0]).toEqual({ status: 'remark_requested', remarkReason: 'Q4 matches the memo' });
  });

  it('refuses paper-only fields on an online appeal', async () => {
    state.queue = [[row('online')], NO_ATTEMPTS];
    const res = await createRemarkRequest('entrant', 'sub-1', 'reason', { questionRefs: 'Q1' }, now);
    expect(res).toEqual({ error: 'Question numbers and pins are only for paper scripts.' });
    expect(state.inserted).toEqual([]);
  });
});

describe('createRemarkRequest — attempts', () => {
  it('allows a second attempt after the first was withdrawn', async () => {
    state.queue = [[row('offline')], [{ status: 'withdrawn' }], []];
    const res = await createRemarkRequest('entrant', 'sub-1', 'Meant Q5, not Q3', { questionRefs: 'Q5' }, now);
    expect(res).toEqual({});
    expect(state.inserted[0]).toMatchObject({ attempt: 2, questionRefs: 'Q5' });
  });

  it('allows a second attempt after the first was resolved', async () => {
    state.queue = [[row('online')], [{ status: 'resolved' }], []];
    expect(await createRemarkRequest('entrant', 'sub-1', 'Still wrong', {}, now)).toEqual({});
    expect(state.inserted[0]).toMatchObject({ attempt: 2 });
  });

  it('refuses while a request is pending', async () => {
    state.queue = [[row('offline')], [{ status: 'pending' }]];
    expect(await createRemarkRequest('entrant', 'sub-1', 'reason', {}, now)).toEqual({
      error: 'Your remark request is still being reviewed.',
    });
    expect(state.inserted).toEqual([]);
  });

  it('refuses a third attempt', async () => {
    state.queue = [[row('offline')], [{ status: 'withdrawn' }, { status: 'resolved' }]];
    expect(await createRemarkRequest('entrant', 'sub-1', 'reason', {}, now)).toEqual({
      error: 'You have used all 2 remark requests for this paper.',
    });
  });
});

describe('createRemarkRequest — paper scripts', () => {
  it('allows an appeal with no script uploaded, using the reason only', async () => {
    state.queue = [[row('offline')], NO_ATTEMPTS, []];
    const res = await createRemarkRequest('entrant', 'sub-1', 'My total was added up wrong', {}, now);
    expect(res).toEqual({});
    expect(state.inserted[0]).toMatchObject({ questionRefs: null, pins: null });
  });

  it('stores question refs without needing a script', async () => {
    state.queue = [[row('offline')], NO_ATTEMPTS, []];
    const res = await createRemarkRequest('entrant', 'sub-1', 'reason', { questionRefs: ' Q3, Q5b ' }, now);
    expect(res).toEqual({});
    expect(state.inserted[0]).toMatchObject({ questionRefs: 'Q3, Q5b', pins: null });
    // No page-count lookup when there are no pins
    expect(state.selects).toBe(3);
  });

  it('stores pins on pages of the uploaded script', async () => {
    state.queue = [[row('offline')], NO_ATTEMPTS, [{ pages: 3 }], []];
    const pins = [{ page: 2, x: 0.25, y: 0.75, note: 'Method mark missing' }];
    const res = await createRemarkRequest('entrant', 'sub-1', 'reason', { questionRefs: 'Q7', pins }, now);
    expect(res).toEqual({});
    expect(state.inserted[0]).toMatchObject({ questionRefs: 'Q7', pins });
  });

  it('rejects pins past the script’s last page', async () => {
    state.queue = [[row('offline')], NO_ATTEMPTS, [{ pages: 2 }]];
    const res = await createRemarkRequest(
      'entrant', 'sub-1', 'reason', { pins: [{ page: 2, x: 0.5, y: 0.5, note: '' }] }, now
    );
    expect(res).toEqual({ error: 'Pin 1 is not on a page of your script.' });
    expect(state.inserted).toEqual([]);
  });

  it('rejects pins when no script was uploaded', async () => {
    state.queue = [[row('offline')], NO_ATTEMPTS, [{ pages: 0 }]];
    const res = await createRemarkRequest(
      'entrant', 'sub-1', 'reason', { pins: [{ page: 0, x: 0.5, y: 0.5, note: '' }] }, now
    );
    expect(res).toEqual({ error: 'Pins can only be added once your script has been uploaded.' });
  });

  it('still requires a reason', async () => {
    expect(await createRemarkRequest('entrant', 'sub-1', '   ', { questionRefs: 'Q1' }, now)).toEqual({
      error: 'Please explain which questions should be reviewed and why.',
    });
  });
});

describe('withdrawRemarkRequest', () => {
  it('withdraws the entrant’s own pending request and resets the result summary', async () => {
    state.queue = [[{ id: 'remark-1', submissionId: 'sub-1' }], [{ status: 'withdrawn' }]];
    expect(await withdrawRemarkRequest('entrant', 'remark-1')).toEqual({});
    expect(state.updates[0]).toEqual({ status: 'withdrawn' });
    expect(state.updates[1]).toEqual({ status: 'auto_marked', remarkReason: null });
  });

  it('keeps a completed earlier remark as the result summary', async () => {
    state.queue = [
      [{ id: 'remark-2', submissionId: 'sub-1' }],
      [{ status: 'resolved' }, { status: 'withdrawn' }],
    ];
    expect(await withdrawRemarkRequest('entrant', 'remark-2')).toEqual({});
    expect(state.updates[1]).toEqual({ status: 'remark_resolved' });
  });

  it('refuses someone else’s request', async () => {
    state.queue = [[]];
    expect(await withdrawRemarkRequest('other', 'remark-1')).toEqual({
      error: 'You can only withdraw your own remark requests.',
    });
    expect(state.updates).toEqual([]);
  });

  it('refuses once a marker has resolved it (the race is decided atomically)', async () => {
    state.queue = [[{ id: 'remark-1', submissionId: 'sub-1' }]];
    state.returning = []; // the conditional update matched no pending row
    expect(await withdrawRemarkRequest('entrant', 'remark-1')).toEqual({
      error: 'This request has already been reviewed, so it can no longer be withdrawn.',
    });
    expect(state.updates).toHaveLength(1);
  });
});
