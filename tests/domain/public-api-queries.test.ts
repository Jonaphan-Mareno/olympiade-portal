import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable stand-in for Drizzle's query builder: every method returns the
// same thenable, and awaiting it resolves the next queued result (shifted per
// await, in call order). This mirrors how the real queries are consumed:
// db.select()...from()...where()...orderBy()/limit() then awaited as rows.
const state = vi.hoisted(() => ({ results: [] as any[] }));

vi.mock('@/lib/db', () => {
  function thenable(): any {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (value: any) => unknown, reject: (err: any) => unknown) =>
        Promise.resolve(state.results.shift() ?? []).then(resolve, reject),
    };
    return chain;
  }

  return {
    db: {
      select: () => thenable(),
      selectDistinct: () => thenable(),
    },
  };
});

import {
  getPublicRoundContext,
  listPublicPortals,
  listPublicRounds,
  listPublicSchools,
  listRoundQuestionPapers,
  listRoundQuestions,
  listRoundScores,
} from '@/domain/public-api/queries';

beforeEach(() => {
  state.results = [];
});

describe('listPublicSchools', () => {
  it('maps rows to name + external_id', async () => {
    state.results = [
      [
        { name: 'Alpha High', externalId: 'A1' },
        { name: 'Beta High', externalId: null },
      ],
    ];

    await expect(listPublicSchools()).resolves.toEqual([
      { name: 'Alpha High', external_id: 'A1' },
      { name: 'Beta High', external_id: null },
    ]);
  });
});

describe('listPublicPortals', () => {
  it('groups schools under their portal', async () => {
    state.results = [
      [
        {
          id: 'p1',
          name: 'Maths Olympiad',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          status: 'approved',
        },
        {
          id: 'p2',
          name: 'Physics Olympiad',
          createdAt: new Date('2026-02-01T00:00:00Z'),
          status: 'pending',
        },
      ],
      [
        { portalId: 'p1', name: 'Alpha High', externalId: 'A1' },
        { portalId: 'p2', name: 'Beta High', externalId: 'B1' },
        { portalId: 'p1', name: 'Gamma High', externalId: null },
      ],
    ];

    await expect(listPublicPortals()).resolves.toEqual([
      {
        id: 'p1',
        name: 'Maths Olympiad',
        created_at: new Date('2026-01-01T00:00:00Z'),
        status: 'approved',
        schools: [
          { name: 'Alpha High', external_id: 'A1' },
          { name: 'Gamma High', external_id: null },
        ],
      },
      {
        id: 'p2',
        name: 'Physics Olympiad',
        created_at: new Date('2026-02-01T00:00:00Z'),
        status: 'pending',
        schools: [{ name: 'Beta High', external_id: 'B1' }],
      },
    ]);
  });

  it('returns an empty school list for portals without schools', async () => {
    state.results = [
      [
        {
          id: 'p1',
          name: 'Maths Olympiad',
          createdAt: null,
          status: 'approved',
        },
      ],
      [],
    ];

    const portals = await listPublicPortals();

    expect(portals[0].schools).toEqual([]);
  });
});

describe('listPublicRounds', () => {
  it('nests the portal and converts the numeric threshold', async () => {
    state.results = [
      [
        {
          id: 'r1',
          name: 'Round 1',
          qualifyingThreshold: '30.5',
          opensAt: new Date('2026-03-01T09:00:00Z'),
          closesAt: new Date('2026-03-10T17:00:00Z'),
          portalId: 'p1',
          portalName: 'Maths Olympiad',
        },
        {
          id: 'r2',
          name: 'Round 2',
          qualifyingThreshold: null,
          opensAt: new Date('2026-04-01T09:00:00Z'),
          closesAt: new Date('2026-04-10T17:00:00Z'),
          portalId: 'p1',
          portalName: 'Maths Olympiad',
        },
      ],
    ];

    const rounds = await listPublicRounds();

    expect(rounds[0]).toEqual({
      id: 'r1',
      name: 'Round 1',
      qualifying_threshold: 30.5,
      opens_at: new Date('2026-03-01T09:00:00Z'),
      closes_at: new Date('2026-03-10T17:00:00Z'),
      portal: { id: 'p1', name: 'Maths Olympiad' },
    });
    expect(rounds[1].qualifying_threshold).toBeNull();
  });
});

describe('getPublicRoundContext', () => {
  it('returns null when the round does not exist', async () => {
    state.results = [[]];

    await expect(getPublicRoundContext('missing')).resolves.toBeNull();
  });

  it('maps the round and its portal', async () => {
    state.results = [
      [
        {
          roundId: 'r1',
          roundName: 'Round 1',
          opensAt: new Date('2026-03-01T09:00:00Z'),
          closesAt: new Date('2026-03-10T17:00:00Z'),
          resultsPublishedAt: null,
          portalId: 'p1',
          portalName: 'Maths Olympiad',
        },
      ],
    ];

    await expect(getPublicRoundContext('r1')).resolves.toEqual({
      round: {
        id: 'r1',
        name: 'Round 1',
        opensAt: new Date('2026-03-01T09:00:00Z'),
        closesAt: new Date('2026-03-10T17:00:00Z'),
        resultsPublishedAt: null,
      },
      portal: { id: 'p1', name: 'Maths Olympiad' },
    });
  });
});

describe('listRoundScores', () => {
  it('converts numeric scores to numbers', async () => {
    state.results = [[{ score: '17' }, { score: '9' }]];

    await expect(listRoundScores('r1')).resolves.toEqual([17, 9]);
  });
});

describe('listRoundQuestionPapers', () => {
  it('exposes file urls as public_url and skips rows without a file', async () => {
    state.results = [
      [
        {
          id: 'paper-1',
          fileUrl: 'https://storage.example/papers/paper-1.pdf',
        },
        { id: 'paper-2', fileUrl: null },
      ],
    ];

    await expect(listRoundQuestionPapers('r1')).resolves.toEqual([
      {
        id: 'paper-1',
        public_url: 'https://storage.example/papers/paper-1.pdf',
      },
    ]);
  });
});

describe('listRoundQuestions', () => {
  it('maps question rows to the public contract', async () => {
    state.results = [
      [
        {
          id: 'q1',
          questionType: 'single_choice',
          prompt: 'What is 2 + 2?',
          options: ['3', '4'],
          correctAnswer: '4',
          marks: 2,
          imageUrl: null,
        },
      ],
    ];

    await expect(listRoundQuestions('r1')).resolves.toEqual([
      {
        id: 'q1',
        question_type: 'single_choice',
        prompt: 'What is 2 + 2?',
        options: ['3', '4'],
        correct_answer: '4',
        marks: 2,
        image_url: null,
      },
    ]);
  });
});
