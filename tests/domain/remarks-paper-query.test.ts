import { describe, it, expect, vi, beforeEach } from 'vitest';

// createRemarkRequest with the paper-script query (question refs + pins).
// Selects come from a FIFO queue; the inserted remark and result updates are
// recorded so we can assert exactly what was stored.
const state = vi.hoisted(() => ({
  queue: [] as any[][],
  selects: 0,
  inserted: [] as any[],
  updates: [] as any[],
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
          return Promise.resolve();
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

import { createRemarkRequest } from '@/domain/remarks/remarks';

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
  existingId: null,
});

beforeEach(() => {
  state.queue = [];
  state.selects = 0;
  state.inserted = [];
  state.updates = [];
});

describe('createRemarkRequest — online appeals are unchanged', () => {
  it('stores the reason only, with no extra lookups', async () => {
    state.queue = [[row('online')], [] /* school educators to notify */];

    const res = await createRemarkRequest('entrant', 'sub-1', '  Q4 matches the memo ', {}, now);

    expect(res).toEqual({});
    expect(state.inserted[0]).toMatchObject({
      submissionId: 'sub-1',
      reason: 'Q4 matches the memo',
      questionRefs: null,
      pins: null,
      previousScore: '12',
    });
    expect(state.updates[0]).toEqual({ status: 'remark_requested', remarkReason: 'Q4 matches the memo' });
    expect(state.selects).toBe(2);
  });

  it('refuses paper-only fields on an online appeal', async () => {
    state.queue = [[row('online')]];
    const res = await createRemarkRequest('entrant', 'sub-1', 'reason', { questionRefs: 'Q1' }, now);
    expect(res).toEqual({ error: 'Question numbers and pins are only for paper scripts.' });
    expect(state.inserted).toEqual([]);
  });
});

describe('createRemarkRequest — paper scripts', () => {
  it('allows an appeal with no script uploaded, using the reason only', async () => {
    state.queue = [[row('offline')], []];
    const res = await createRemarkRequest('entrant', 'sub-1', 'My total was added up wrong', {}, now);
    expect(res).toEqual({});
    expect(state.inserted[0]).toMatchObject({ questionRefs: null, pins: null });
  });

  it('stores question refs without needing a script', async () => {
    state.queue = [[row('offline')], []];
    const res = await createRemarkRequest('entrant', 'sub-1', 'reason', { questionRefs: ' Q3, Q5b ' }, now);
    expect(res).toEqual({});
    expect(state.inserted[0]).toMatchObject({ questionRefs: 'Q3, Q5b', pins: null });
    // No page-count lookup when there are no pins
    expect(state.selects).toBe(2);
  });

  it('stores pins on pages of the uploaded script', async () => {
    state.queue = [[row('offline')], [{ pages: 3 }], []];
    const pins = [{ page: 2, x: 0.25, y: 0.75, note: 'Method mark missing' }];
    const res = await createRemarkRequest('entrant', 'sub-1', 'reason', { questionRefs: 'Q7', pins }, now);
    expect(res).toEqual({});
    expect(state.inserted[0]).toMatchObject({ questionRefs: 'Q7', pins });
  });

  it('rejects pins past the script’s last page', async () => {
    state.queue = [[row('offline')], [{ pages: 2 }]];
    const res = await createRemarkRequest(
      'entrant', 'sub-1', 'reason', { pins: [{ page: 2, x: 0.5, y: 0.5, note: '' }] }, now
    );
    expect(res).toEqual({ error: 'Pin 1 is not on a page of your script.' });
    expect(state.inserted).toEqual([]);
  });

  it('rejects pins when no script was uploaded', async () => {
    state.queue = [[row('offline')], [{ pages: 0 }]];
    const res = await createRemarkRequest(
      'entrant', 'sub-1', 'reason', { pins: [{ page: 0, x: 0.5, y: 0.5, note: '' }] }, now
    );
    expect(res).toEqual({ error: 'Pins can only be added once your script has been uploaded.' });
  });

  it('still requires a reason and the usual eligibility', async () => {
    expect(await createRemarkRequest('entrant', 'sub-1', '   ', { questionRefs: 'Q1' }, now)).toEqual({
      error: 'Please explain which questions should be reviewed and why.',
    });
    state.queue = [[{ ...row('offline'), existingId: 'remark-0' }]];
    expect(await createRemarkRequest('entrant', 'sub-1', 'reason', {}, now)).toEqual({
      error: 'A remark has already been requested for this paper.',
    });
  });
});
