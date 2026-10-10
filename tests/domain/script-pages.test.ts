import { describe, it, expect, vi, beforeEach } from 'vitest';

// Selects run in a fixed order, so they are served from a FIFO queue (the
// same approach as remarks.test.ts). Inserts/deletes inside the transaction
// are recorded; storage is an in-memory map of path -> bytes.
const state = vi.hoisted(() => ({
  queue: [] as any[][],
  inserted: [] as any[],
  deleted: 0,
  objects: new Map<string, Uint8Array>(),
  removed: [] as string[][],
  signed: [] as string[],
}));

vi.mock('@/lib/db', () => {
  const select = () => ({
    from: () => {
      const chain: any = {
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => {
          const rows = state.queue.shift() ?? [];
          const p: any = Promise.resolve(rows);
          p.orderBy = () => Promise.resolve(rows);
          p.groupBy = () => Promise.resolve(rows);
          return p;
        },
      };
      return chain;
    },
  });
  const tx = {
    select,
    delete: () => ({ where: () => { state.deleted += 1; return Promise.resolve(); } }),
    insert: () => ({ values: (v: any) => { state.inserted.push(v); return Promise.resolve(); } }),
  };
  return {
    db: {
      select,
      insert: () => ({
        values: (v: any) => {
          state.inserted.push(v);
          const returning = () => Promise.resolve([{ id: 'new-sub' }]);
          return { returning, onConflictDoNothing: () => ({ returning }) };
        },
      }),
      transaction: (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  };
});

vi.mock('@/lib/storage/marked-scripts', () => ({
  createScriptUploadUrl: vi.fn(async (path: string) => {
    state.signed.push(path);
    return { path, token: `token-${state.signed.length}` };
  }),
  downloadScriptObject: vi.fn(async (path: string) => {
    const bytes = state.objects.get(path);
    return bytes ? new Blob([bytes as BlobPart]) : null;
  }),
  removeScriptObjects: vi.fn(async (paths: string[]) => {
    state.removed.push(paths);
  }),
}));

vi.mock('@/domain/rounds/advance-entrants', () => ({
  advanceQualifyingEntrants: vi.fn(async () => null),
}));
vi.mock('@/domain/notifications/in-app-notifications', () => ({
  notifyEducatorsInPortal: vi.fn(async () => {}),
}));

import {
  commitScriptUpload,
  getViewableScriptPage,
  prepareScriptUpload,
} from '@/domain/scripts/script-pages';

const PAGE_ID = '44444444-4444-4444-8444-444444444444';
const ROUND = '11111111-1111-4111-8111-111111111111';
const SUB = '22222222-2222-4222-8222-222222222222';
const published = new Date('2026-09-01T10:00:00Z');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

beforeEach(() => {
  vi.clearAllMocks();
  state.queue = [];
  state.inserted = [];
  state.deleted = 0;
  state.objects = new Map();
  state.removed = [];
  state.signed = [];
});

describe('getViewableScriptPage', () => {
  const pageRow = (over: Record<string, unknown> = {}) => ({
    storagePath: `${ROUND}/${SUB}/original/x.jpg`,
    contentType: 'image/jpeg',
    portalId: 'portal-1',
    resultsPublishedAt: published,
    entrantUserId: 'entrant',
    studentSchoolId: 'school-1',
    ...over,
  });

  it('serves the entrant their own page after publication', async () => {
    state.queue = [[pageRow()]];
    expect(await getViewableScriptPage('entrant', PAGE_ID)).toEqual({
      storagePath: `${ROUND}/${SUB}/original/x.jpg`,
      contentType: 'image/jpeg',
    });
  });

  it('refuses the entrant before publication', async () => {
    state.queue = [
      [pageRow({ resultsPublishedAt: null })],
      [{ ownerUserId: 'organiser' }], // canResolveRemark: not the owner
      [], // not an educator
    ];
    expect(await getViewableScriptPage('entrant', PAGE_ID)).toBeNull();
  });

  it('allows an accepted educator of the entrant’s school, even before publication', async () => {
    state.queue = [
      [pageRow({ resultsPublishedAt: null })],
      [{ ownerUserId: 'organiser' }],
      [{ id: 'edu-membership' }],
    ];
    expect(await getViewableScriptPage('educator', PAGE_ID)).not.toBeNull();
  });

  it('refuses an educator of another school', async () => {
    // The educator lookup is scoped to the entrant's school, so it finds nothing
    state.queue = [[pageRow()], [{ ownerUserId: 'organiser' }], []];
    expect(await getViewableScriptPage('other-educator', PAGE_ID)).toBeNull();
  });

  it('allows the olympiad organiser', async () => {
    state.queue = [[pageRow({ resultsPublishedAt: null })], [{ ownerUserId: 'organiser' }]];
    expect(await getViewableScriptPage('organiser', PAGE_ID)).not.toBeNull();
  });

  it('never serves one entrant another entrant’s page, whatever id they guess', async () => {
    state.queue = [[pageRow()], [{ ownerUserId: 'organiser' }], []];
    expect(await getViewableScriptPage('another-entrant', PAGE_ID)).toBeNull();
  });

  it('treats unknown and malformed ids as not found without querying', async () => {
    state.queue = [[]];
    expect(await getViewableScriptPage('entrant', PAGE_ID)).toBeNull();
    state.queue = [];
    expect(await getViewableScriptPage('entrant', "1' OR '1'='1")).toBeNull();
  });
});

describe('original script uploads', () => {
  const target = { kind: 'original' as const, roundId: ROUND, studentMembershipId: 'stu-1' };
  const openRound = {
    id: ROUND,
    portalId: 'portal-1',
    deliveryMethod: 'paper',
    opensAt: new Date(Date.now() - 3 * 86400000),
    closesAt: new Date(Date.now() - 86400000),
    markingClosesAt: new Date(Date.now() + 86400000),
    resultsPublishedAt: null,
  };
  // loadOfflineMarkingRound, checkEntrantsAtEducatorSchools, findOrCreateOfflineSubmission
  const authorised = (round: Record<string, unknown> = openRound) => [
    [round],
    [{ id: 'edu-m', schoolId: 'school-1' }],
    [{ id: 'stu-1', schoolId: 'school-1' }],
    [{ id: SUB, submissionType: 'offline' }],
  ];

  it('issues one signed upload URL per page under the submission’s path', async () => {
    state.queue = authorised();
    const res = await prepareScriptUpload('educator', target, [
      { contentType: 'image/jpeg', size: 1000 },
      { contentType: 'image/png', size: 2000 },
    ]);
    expect('uploads' in res && res.uploads).toHaveLength(2);
    expect(state.signed[0]).toMatch(new RegExp(`^${ROUND}/${SUB}/original/[0-9a-f-]{36}\\.jpg$`));
    expect(state.signed[1]).toMatch(/\.png$/);
  });

  it('creates the offline submission when the entrant has none yet', async () => {
    state.queue = [...authorised().slice(0, 3), []];
    const res = await prepareScriptUpload('educator', target, [{ contentType: 'image/jpeg', size: 10 }]);
    expect(res).toHaveProperty('uploads');
    expect(state.inserted[0]).toMatchObject({
      roundId: ROUND,
      studentMembershipId: 'stu-1',
      submissionType: 'offline',
    });
    expect(state.signed[0]).toContain('/new-sub/original/');
  });

  it('rejects bad types, sizes and page counts before touching the db', async () => {
    expect(await prepareScriptUpload('educator', target, [{ contentType: 'image/heic', size: 10 }]))
      .toHaveProperty('error');
    expect(await prepareScriptUpload('educator', target, [{ contentType: 'image/jpeg', size: 11 * 1024 * 1024 }]))
      .toEqual({ error: 'Each page must be 10 MB or smaller.' });
    expect(await prepareScriptUpload('educator', target, Array(31).fill({ contentType: 'image/jpeg', size: 10 })))
      .toEqual({ error: 'A script can have at most 30 pages.' });
    expect(await prepareScriptUpload('educator', target, [])).toEqual({ error: 'Add at least one page.' });
    expect(state.signed).toEqual([]);
  });

  it('freezes original pages once results are published', async () => {
    state.queue = [[{ ...openRound, resultsPublishedAt: published }]];
    expect(await prepareScriptUpload('educator', target, [{ contentType: 'image/jpeg', size: 10 }])).toEqual({
      error: 'Results have been published. Changes now go through a remark request.',
    });
  });

  it('refuses online rounds and entrants at other schools', async () => {
    state.queue = [[{ ...openRound, deliveryMethod: 'online' }]];
    expect(await prepareScriptUpload('educator', target, [{ contentType: 'image/jpeg', size: 10 }]))
      .toHaveProperty('error', 'This round is written online, so marks cannot be entered manually.');

    state.queue = [[openRound], [{ id: 'edu-m', schoolId: 'school-1' }], [{ id: 'stu-1', schoolId: 'school-2' }]];
    expect(await prepareScriptUpload('educator', target, [{ contentType: 'image/jpeg', size: 10 }]))
      .toEqual({ error: 'You can only enter marks for entrants at your school.' });
  });

  it('commits checked pages in order and removes the replaced ones', async () => {
    const p1 = `${ROUND}/${SUB}/original/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
    const p2 = `${ROUND}/${SUB}/original/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`;
    state.objects.set(p1, JPEG);
    state.objects.set(p2, PNG);
    state.queue = [...authorised(), [{ storagePath: 'old/page.jpg' }]];

    const res = await commitScriptUpload('educator', target, [
      { path: p1, contentType: 'image/jpeg' },
      { path: p2, contentType: 'image/png' },
    ]);

    expect(res).toEqual({ pageCount: 2 });
    expect(state.deleted).toBe(1);
    expect(state.inserted[0]).toEqual([
      expect.objectContaining({ submissionId: SUB, kind: 'original', remarkRequestId: null, pageIndex: 0, storagePath: p1, contentType: 'image/jpeg' }),
      expect.objectContaining({ pageIndex: 1, storagePath: p2, contentType: 'image/png', sizeBytes: PNG.length }),
    ]);
    expect(state.removed).toEqual([['old/page.jpg']]);
  });

  it('rejects a page whose bytes are not the image it claims, and deletes the upload', async () => {
    const p1 = `${ROUND}/${SUB}/original/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
    state.objects.set(p1, new TextEncoder().encode('%PDF-1.7 not an image'));
    state.queue = authorised();

    const res = await commitScriptUpload('educator', target, [{ path: p1, contentType: 'image/jpeg' }]);

    expect(res).toEqual({ error: 'One of the pages is not a JPEG, PNG or WebP image.' });
    expect(state.inserted).toEqual([]);
    expect(state.removed).toEqual([[p1]]);
  });

  it('never attaches objects from another submission’s path', async () => {
    const foreign = `${ROUND}/99999999-9999-4999-8999-999999999999/original/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
    state.objects.set(foreign, JPEG);
    state.queue = authorised();

    const res = await commitScriptUpload('educator', target, [{ path: foreign, contentType: 'image/jpeg' }]);

    expect(res).toHaveProperty('error');
    expect(state.inserted).toEqual([]);
    // ...and never deletes it either
    expect(state.removed).toEqual([[]]);
  });

  it('re-checks the marking window at commit time', async () => {
    state.queue = [[{ ...openRound, markingClosesAt: new Date(Date.now() - 1000) }]];
    const res = await commitScriptUpload('educator', target, [
      { path: `${ROUND}/${SUB}/original/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`, contentType: 'image/jpeg' },
    ]);
    expect(res).toEqual({ error: 'The marking deadline for this round has passed.' });
  });
});

describe('re-marked page uploads', () => {
  const target = { kind: 'remarked' as const, remarkRequestId: 'remark-1' };
  const request = (over: Record<string, unknown> = {}) => ({
    id: 'remark-1',
    submissionId: SUB,
    status: 'pending',
    roundId: ROUND,
    portalId: 'portal-1',
    submissionType: 'offline',
    studentSchoolId: 'school-1',
    ...over,
  });

  it('lets the resolver add pages without touching the originals', async () => {
    const p1 = `${ROUND}/${SUB}/remarked/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
    state.objects.set(p1, JPEG);
    state.queue = [[request()], [{ ownerUserId: 'organiser' }], []];

    const res = await commitScriptUpload('organiser', target, [{ path: p1, contentType: 'image/jpeg' }]);

    expect(res).toEqual({ pageCount: 1 });
    expect(state.inserted[0][0]).toMatchObject({ kind: 'remarked', remarkRequestId: 'remark-1', pageIndex: 0 });
    // An original-kind path is rejected for a remark
    state.queue = [[request()], [{ ownerUserId: 'organiser' }]];
    expect(
      await commitScriptUpload('organiser', target, [
        { path: p1.replace('/remarked/', '/original/'), contentType: 'image/jpeg' },
      ])
    ).toHaveProperty('error');
  });

  it('refuses online remarks, resolved remarks and non-markers', async () => {
    const files = [{ contentType: 'image/jpeg', size: 10 }];
    state.queue = [[request({ submissionType: 'online' })]];
    expect(await prepareScriptUpload('organiser', target, files)).toHaveProperty('error');

    state.queue = [[request({ status: 'resolved' })]];
    expect(await prepareScriptUpload('organiser', target, files)).toEqual({
      error: 'This remark has already been resolved.',
    });

    state.queue = [[request()], [{ ownerUserId: 'organiser' }], []];
    expect(await prepareScriptUpload('stranger', target, files)).toEqual({
      error: 'You are not allowed to remark this paper.',
    });
  });
});
