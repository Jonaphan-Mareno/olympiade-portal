import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ScoresPage from '@/app/(student)/results/scores/[submissionId]/page';

// The student's paper-review page shows the percentage out of ONE denominator:
// the round's total from getRoundTotalMarks (target total → paper selection →
// pool sum → stated paper total). Summing the dealt variant instead would give
// every entrant a different denominator and make percentages incomparable, so
// these tests pin the denominator as well as the per-question matching marks.

const h = vi.hoisted(() => {
  const state = {
    selectRows: [] as any[][],
    selectCount: 0,
    notFoundCalls: 0,
    redirectCalls: [] as string[],
    authUser: null as { id: string; email?: string } | null,
  };

  const whereResult = (rows: any[]) => {
    const p = Promise.resolve(rows) as Promise<any[]> & {
      limit?: () => Promise<any[]>;
    };
    p.limit = () => p;
    return p;
  };

  const nextRows = () => {
    state.selectCount += 1;
    if (state.selectRows.length === 0) {
      // The page performs a fixed sequence of selects; an unexpected extra one
      // must fail loudly rather than silently read as an empty result.
      throw new Error(`unexpected db.select() #${state.selectCount}`);
    }
    return state.selectRows.shift() ?? [];
  };

  const chain = (): any => {
    const node: any = {
      where: () => whereResult(nextRows()),
      limit: () => node,
    };
    node.leftJoin = () => chain();
    node.innerJoin = () => chain();
    return node;
  };

  const db = { select: () => ({ from: () => chain() }) };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.authUser }, error: null }) },
  };

  return { state, db, supabase };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => h.supabase,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    h.state.notFoundCalls += 1;
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    h.state.redirectCalls.push(to);
    throw new Error('REDIRECT');
  },
}));
// The appeal panel is a client component with its own form; it is irrelevant to
// the denominator and matching-mark behaviour under test here.
vi.mock('@/app/(student)/results/scores/[submissionId]/RemarkSection', () => ({
  default: () => <div data-testid="remark-section" />,
}));

const MATCH_PAIRS = [
  { premise: 'France', response: 'Paris' },
  { premise: 'Italy', response: 'Rome' },
  { premise: 'Spain', response: 'Madrid' },
];
const MATCH_PROMPT = 'Match each country to its capital';

async function renderPage(submissionId = 'sub-1') {
  const page = await ScoresPage({ params: Promise.resolve({ submissionId }) });
  render(page);
}

/** The subData row of the page's first (joined) select. */
function subDataRow(opts: {
  score?: string | null;
  answersJson?: Record<string, unknown>;
  variantQuestionIds?: string[] | null;
  submissionType?: string;
}) {
  return [
    {
      submission: {
        id: 'sub-1',
        roundId: 'round-1',
        studentMembershipId: 'membership-1',
        submissionType: opts.submissionType ?? 'online',
        answersJson: opts.answersJson ?? {},
        variantQuestionIds: opts.variantQuestionIds ?? null,
      },
      result: opts.score === null ? null : { score: opts.score ?? '0', feedback: null },
      roundName: 'Round 1',
      roundId: 'round-1',
      resultsPublishedAt: new Date('2026-09-12T09:00:00Z'),
      portalName: 'Maths Olympiad',
    },
  ];
}

/** The sitting + saved-answer selects that follow the question load. */
function queueSitting(rows: any[] = []) {
  h.state.selectRows.push([{ sitting: { id: 'sitting-1' } }]);
  h.state.selectRows.push(rows);
}

function queueRoundTotal(opts: {
  pool?: any[];
  targetTotalMarks?: number | null;
  paperTotalMarks?: number | null;
  papers?: any[];
}) {
  h.state.selectRows.push(opts.pool ?? []);
  h.state.selectRows.push([
    {
      id: 'round-1',
      targetTotalMarks: opts.targetTotalMarks ?? null,
      paperTotalMarks: opts.paperTotalMarks ?? null,
    },
  ]);
  h.state.selectRows.push(opts.papers ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.selectRows = [];
  h.state.selectCount = 0;
  h.state.notFoundCalls = 0;
  h.state.redirectCalls = [];
  h.state.authUser = { id: 'user-1', email: 'student@example.com' };
});

describe('ScoresPage denominator', () => {
  const VARIANT = ['q-1', 'q-2']; // dealt variant worth 5 + 10 = 15
  const POOL = [
    { id: 'q-1', roundId: 'round-1', marks: 5 },
    { id: 'q-2', roundId: 'round-1', marks: 10 },
    { id: 'q-3', roundId: 'round-1', marks: 10 },
  ];
  const QUESTIONS = [
    {
      id: 'q-1',
      prompt: 'What is 2 + 2?',
      marks: 5,
      questionType: 'single_choice',
      options: ['3', '4'],
      correctAnswer: '4',
    },
    {
      id: 'q-2',
      prompt: 'What is 3 + 3?',
      marks: 10,
      questionType: 'single_choice',
      options: ['5', '6'],
      correctAnswer: '6',
    },
  ];

  it('uses the round target total, not the sum of the dealt variant', async () => {
    h.state.selectRows = [
      subDataRow({ score: '25', answersJson: { 'q-1': '4', 'q-2': '6' }, variantQuestionIds: VARIANT }),
      [], // no remark request
      QUESTIONS, // loadSittingQuestions: the dealt variant only
    ];
    queueSitting();
    // The pool sums to 25 but the organiser's target total of 50 outranks it.
    queueRoundTotal({ pool: POOL, targetTotalMarks: 50 });

    await renderPage();

    // 25 / 50 = 50%. The rejected per-entrant denominator (25 / 15) would show
    // 166.7%, and the pool-sum fallback would show 100%.
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Final Score')).toBeInTheDocument();
  });

  it('falls back to the pool sum when the round sets no target total', async () => {
    h.state.selectRows = [
      subDataRow({ score: '18', answersJson: { 'q-1': '4', 'q-2': '6' }, variantQuestionIds: VARIANT }),
      [],
      QUESTIONS,
    ];
    queueSitting();
    queueRoundTotal({ pool: POOL, targetTotalMarks: null });

    await renderPage();

    expect(screen.getByText('72%')).toBeInTheDocument();
  });

  it('shows the raw mark when the round has no computable total', async () => {
    h.state.selectRows = [subDataRow({ score: '14', answersJson: {} }), [], []];
    queueSitting();
    queueRoundTotal({ pool: [], targetTotalMarks: null, paperTotalMarks: null });

    await renderPage();

    expect(screen.getByText('14 marks')).toBeInTheDocument();
    expect(screen.getByText('This round has no questions to display.')).toBeInTheDocument();
  });

  it('returns not-found when the submission is not the student’s', async () => {
    h.state.selectRows = [[]];

    await expect(renderPage()).rejects.toThrow('NOT_FOUND');
    expect(h.state.notFoundCalls).toBe(1);
  });

  it('redirects an anonymous visitor to login', async () => {
    h.state.authUser = null;

    await expect(renderPage()).rejects.toThrow('REDIRECT');
    expect(h.state.redirectCalls).toEqual(['/login']);
  });
});

describe('ScoresPage matching marks', () => {
  const MATCH_QUESTION = {
    id: 'q-match',
    prompt: MATCH_PROMPT,
    marks: 6,
    questionType: 'matching',
    options: MATCH_PAIRS,
    correctAnswer: null,
  };

  async function renderMatching(answersJson: Record<string, unknown>) {
    h.state.selectRows = [
      subDataRow({ score: '4', answersJson, variantQuestionIds: ['q-match'] }),
      [], // no remark request
      [MATCH_QUESTION], // loadSittingQuestions
    ];
    queueSitting([{ questionId: 'q-match', manualScore: null, educatorFeedback: null }]);
    queueRoundTotal({ pool: [{ id: 'q-match', roundId: 'round-1', marks: 6 }] });
    await renderPage();
  }

  it('awards proportional marks from the aggregated payload under the base id', async () => {
    await renderMatching({
      'q-match': JSON.stringify({
        'q-match_0': 'Paris',
        'q-match_1': 'Rome',
        'q-match_2': 'Berlin',
      }),
    });

    // 2 of 3 pairs -> 4 of 6, not 0 and not all-or-nothing.
    expect(screen.getByText('4 / 6 Marks')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.getByText('Correct Matches')).toBeInTheDocument();
  });

  it('reassembles legacy per-pair answer keys', async () => {
    await renderMatching({
      'q-match_0': 'Paris',
      'q-match_1': 'Rome',
      'q-match_2': 'Madrid',
    });

    expect(screen.getByText('6 / 6 Marks')).toBeInTheDocument();
    expect(screen.getAllByText('Paris')).toHaveLength(1);
    expect(screen.queryByText('Correct Matches')).not.toBeInTheDocument();
  });

  it('shows zero rather than crashing when no pair was chosen', async () => {
    await renderMatching({});

    expect(screen.getByText('0 / 6 Marks')).toBeInTheDocument();
    expect(screen.getAllByText('(No match selected)')).toHaveLength(3);
  });

  it('reads the educator mark for free text and excludes it from auto-marking', async () => {
    h.state.selectRows = [
      subDataRow({
        score: '3',
        answersJson: { 'q-free': 'Because the derivative is positive.' },
        variantQuestionIds: ['q-free'],
      }),
      [],
      [
        {
          id: 'q-free',
          prompt: 'Explain why the function increases',
          marks: 4,
          questionType: 'free_text',
          options: null,
          correctAnswer: null,
        },
      ],
    ];
    queueSitting([{ questionId: 'q-free', manualScore: '3', educatorFeedback: 'Well argued.' }]);
    queueRoundTotal({ pool: [{ id: 'q-free', roundId: 'round-1', marks: 4 }] });

    await renderPage();

    expect(screen.getByText('3 / 4 Marks')).toBeInTheDocument();
    expect(screen.getByText('Because the derivative is positive.')).toBeInTheDocument();
    expect(screen.getByText('"Well argued."')).toBeInTheDocument();
  });
});
