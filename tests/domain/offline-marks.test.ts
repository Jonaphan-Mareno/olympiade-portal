import { describe, it, expect, vi, beforeEach } from 'vitest';

// Selects run in a fixed order, so they are served from a FIFO queue (the
// same approach as script-pages.test.ts). `conflictOnInsert` simulates a
// concurrent online submit creating the row between our read and insert:
// ON CONFLICT DO NOTHING then returns no rows.
const state = vi.hoisted(() => ({
  queue: [] as any[][],
  inserted: [] as any[],
  conflictOnInsert: false,
  onConflictCalled: false,
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = state.queue.shift() ?? [];
          const p: any = Promise.resolve(rows);
          p.limit = () => Promise.resolve(rows);
          return p;
        },
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        state.inserted.push(v);
        const returning = () =>
          Promise.resolve(state.conflictOnInsert ? [] : [{ id: 'new-sub' }]);
        return {
          returning,
          onConflictDoNothing: () => {
            state.onConflictCalled = true;
            return { returning };
          },
        };
      },
    }),
  },
}));

import { findOrCreateOfflineSubmission } from '@/domain/rounds/offline-marks';

const ROUND = 'round-1';
const STUDENT = 'stu-1';
const EDUCATOR = 'edu-1';

beforeEach(() => {
  state.queue = [];
  state.inserted = [];
  state.conflictOnInsert = false;
  state.onConflictCalled = false;
});

describe('findOrCreateOfflineSubmission', () => {
  it('creates an offline submission when the entrant has none', async () => {
    state.queue = [[]];
    expect(await findOrCreateOfflineSubmission(ROUND, STUDENT, EDUCATOR)).toBe('new-sub');
    expect(state.inserted[0]).toMatchObject({
      roundId: ROUND,
      studentMembershipId: STUDENT,
      submittedByMembershipId: EDUCATOR,
      submissionType: 'offline',
      status: 'submitted',
    });
    expect(state.onConflictCalled).toBe(true);
  });

  it('reuses an existing offline submission without inserting', async () => {
    state.queue = [[{ id: 'off-sub', submissionType: 'offline' }]];
    expect(await findOrCreateOfflineSubmission(ROUND, STUDENT, EDUCATOR)).toBe('off-sub');
    expect(state.inserted).toEqual([]);
  });

  it('never touches a script the entrant already wrote online', async () => {
    state.queue = [[{ id: 'online-sub', submissionType: 'online' }]];
    expect(await findOrCreateOfflineSubmission(ROUND, STUDENT, EDUCATOR)).toBeNull();
    expect(state.inserted).toEqual([]);
  });

  it('skips the entrant when a concurrent online submit wins the insert race (first is final)', async () => {
    state.conflictOnInsert = true;
    // Initial read sees nothing; the re-read after the conflict sees the online winner.
    state.queue = [[], [{ id: 'online-sub', submissionType: 'online' }]];
    expect(await findOrCreateOfflineSubmission(ROUND, STUDENT, EDUCATOR)).toBeNull();
    expect(state.queue).toEqual([]); // the winner was re-read
  });

  it('uses the winning row when a concurrent offline write wins the race', async () => {
    state.conflictOnInsert = true;
    state.queue = [[], [{ id: 'other-off-sub', submissionType: 'offline' }]];
    expect(await findOrCreateOfflineSubmission(ROUND, STUDENT, EDUCATOR)).toBe('other-off-sub');
  });

  it('returns null rather than throwing if the conflicting row cannot be re-read', async () => {
    state.conflictOnInsert = true;
    state.queue = [[], []];
    expect(await findOrCreateOfflineSubmission(ROUND, STUDENT, EDUCATOR)).toBeNull();
  });
});
