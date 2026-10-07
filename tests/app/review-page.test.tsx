import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ReviewPage from '@/app/(student)/results/[portalId]/rounds/[roundId]/review/page';

// The round review page must present a student's mark as the raw score out of
// the round's total, plus the percentage, and — per question — the marks that
// add up to that score. Rounds with no questions in the bank (e.g. manually
// graded paper rounds) have no computable total and fall back to the raw mark
// alone.

// The review page refuses to show results unless the round has been
// released, so every fixture must include a released round row.
const releasedRound = {
  id: 'round-1',
  opensAt: new Date('2026-09-01T09:00:00Z'),
  closesAt: new Date('2026-09-10T17:00:00Z'),
  resultsPublishedAt: new Date('2026-09-12T09:00:00Z'),
};

const h = vi.hoisted(() => {
  const state = {
    // Queued row arrays, one per select() the page performs
    selectRows: [] as any[][],
    selectCount: 0,
    notFoundCalls: 0,
    authUser: null as { id: string; email?: string } | null,
  };

  // `.where(...)` is awaited directly for the round and questions queries but
  // chained with `.limit(1)` for the membership and submission queries, so
  // return a promise that also exposes `limit`.
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
      // Fail loudly rather than silently returning [] — the page performs a
      // fixed sequence of selects and an unexpected extra one is a bug.
      throw new Error(`unexpected db.select() #${state.selectCount}`);
    }
    return state.selectRows.shift() ?? [];
  };

  // A chainable builder: `.from(t).where()` / `.leftJoin(t).where()` /
  // `.innerJoin(t).innerJoin(t).where()` all end in a queued select.
  const chain = (): any => {
    const node: any = {
      where: () => whereResult(nextRows()),
      limit: () => node,
    };
    node.leftJoin = () => chain();
    node.innerJoin = () => chain();
    return node;
  };

  const db = {
    select: () => ({
      from: () => chain(),
    }),
  };

  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: state.authUser }, error: null }),
    },
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
}));

async function renderPage() {
  // params is a Promise in Next 16 server components
  const page = await ReviewPage({
    params: Promise.resolve({ portalId: 'portal-1', roundId: 'round-1' }),
  });
  render(page);
}

/**
 * getQuestionMarks() runs after the page's own question load and performs:
 *   1. the submission row (roundId / membership / answersJson / variant),
 *   2. loadSittingQuestions again,
 *   3. the remark request for the submission,
 *   4. the student's manual scores — only when the submission carries a
 *      studentMembershipId (otherwise no select happens at all).
 * getRoundTotalMarks() then performs 3 selects: pool, round, paper selection.
 */
function queueMarks(opts: {
  submission: any;
  questions: any[];
  remark?: any[];
  manualScores?: any[];
}) {
  h.state.selectRows.push([opts.submission]);
  h.state.selectRows.push(opts.questions);
  h.state.selectRows.push(opts.remark ?? []);
  if (opts.submission.studentMembershipId) {
    h.state.selectRows.push(opts.manualScores ?? []);
  }
}

function queueRoundTotal(pool: any[], round: any, papers: any[] = []) {
  h.state.selectRows.push(pool);
  h.state.selectRows.push([round]);
  h.state.selectRows.push(papers);
}

const noTotalRound = { id: 'round-1', targetTotalMarks: null, paperTotalMarks: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.state.selectRows = [];
  h.state.selectCount = 0;
  h.state.notFoundCalls = 0;
  h.state.authUser = { id: 'user-1', email: 'student@example.com' };
});

describe('ReviewPage score display', () => {
  it('shows the raw mark out of the total and the percentage', async () => {
    const questions = [
      { id: 'q-1', prompt: 'What is 2 + 2?', marks: 5, correctAnswer: '4', questionType: 'single_choice' },
      { id: 'q-2', prompt: 'What is 3 + 3?', marks: 10, correctAnswer: '6', questionType: 'single_choice' },
      { id: 'q-3', prompt: 'What is 4 + 4?', marks: 10, correctAnswer: '8', questionType: 'single_choice' },
    ];
    const submission = {
      id: 'sub-1',
      roundId: 'round-1',
      answersJson: { 'q-1': '4' },
      variantQuestionIds: null,
    };

    h.state.selectRows = [
      [{ id: 'membership-1', userId: 'user-1', portalId: 'portal-1' }], // membership
      [releasedRound], // round (released, so the embargo check passes)
      [
        {
          submission,
          result: { score: '18', feedback: 'Auto-marked: 18 / 25' },
        },
      ], // submission + result
      questions, // loadSittingQuestions: the questions to display
    ];
    queueMarks({ submission, questions });
    // getRoundTotalMarks: pool, round, paper selection -> pool sum = 25.
    queueRoundTotal(
      [
        { id: 'q-1', roundId: 'round-1', marks: 5 },
        { id: 'q-2', roundId: 'round-1', marks: 10 },
        { id: 'q-3', roundId: 'round-1', marks: 10 },
      ],
      noTotalRound
    );

    await renderPage();

    expect(screen.getByText('18 / 25')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('Final Score')).toBeInTheDocument();
  });

  it('shows the raw mark alone when the round has no questions', async () => {
    const submission = {
      id: 'sub-1',
      roundId: 'round-1',
      answersJson: {},
      variantQuestionIds: null,
    };

    h.state.selectRows = [
      [{ id: 'membership-1', userId: 'user-1', portalId: 'portal-1' }], // membership
      [releasedRound], // round (released, so the embargo check passes)
      [{ submission, result: { score: '14', feedback: null } }], // manually graded paper submission
      [], // loadSittingQuestions: no questions in the bank
    ];
    queueMarks({ submission, questions: [] });
    // getRoundTotalMarks: empty pool -> total 0 -> raw mark only.
    queueRoundTotal([], noTotalRound);

    await renderPage();

    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('treats a missing result as zero marks', async () => {
    const questions = [
      { id: 'q-1', prompt: 'What is 2 + 2?', marks: 5, correctAnswer: '4', questionType: 'single_choice' },
      { id: 'q-2', prompt: 'What is 3 + 3?', marks: 5, correctAnswer: '6', questionType: 'single_choice' },
    ];
    const submission = {
      id: 'sub-1',
      roundId: 'round-1',
      answersJson: {},
      variantQuestionIds: null,
    };

    h.state.selectRows = [
      [{ id: 'membership-1', userId: 'user-1', portalId: 'portal-1' }], // membership
      [releasedRound], // round (released, so the embargo check passes)
      [{ submission, result: null }], // submitted but not graded yet
      questions, // loadSittingQuestions: the questions to display
    ];
    queueMarks({ submission, questions });
    // getRoundTotalMarks: pool sum = 10.
    queueRoundTotal(
      [
        { id: 'q-1', roundId: 'round-1', marks: 5 },
        { id: 'q-2', roundId: 'round-1', marks: 5 },
      ],
      noTotalRound
    );

    await renderPage();

    expect(screen.getByText('0 / 10')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('returns not-found when the student has no submission for the round', async () => {
    h.state.selectRows = [
      [{ id: 'membership-1', userId: 'user-1', portalId: 'portal-1' }], // membership
      [releasedRound], // round (released, so the embargo check passes)
      [], // no submission
    ];

    await expect(renderPage()).rejects.toThrow('NOT_FOUND');
    expect(h.state.notFoundCalls).toBe(1);
  });
});

describe('ReviewPage per-question marks', () => {
  const MATCH_PAIRS = [
    { premise: 'France', response: 'Paris' },
    { premise: 'Italy', response: 'Rome' },
    { premise: 'Spain', response: 'Madrid' },
  ];
  const MATCH_PROMPT = 'Match each country to its capital';

  /**
   * The card a question renders into. Scoped queries are needed because the
   * header's "score / total" pill is legitimately identical to a single-question
   * round's per-question pill.
   */
  const cardOf = (prompt: string) =>
    screen.getByText(prompt).closest('div.border') as HTMLElement;

  /** Render a review page for one round of `questions`, returning the cards. */
  async function renderWithQuestions(opts: {
    questions: any[];
    answersJson: Record<string, unknown>;
    score?: string | null;
    pool?: any[];
    manualScores?: any[];
    studentMembershipId?: string | null;
    remark?: any[];
  }) {
    const submission = {
      id: 'sub-1',
      roundId: 'round-1',
      answersJson: opts.answersJson,
      variantQuestionIds: null,
      studentMembershipId: opts.studentMembershipId ?? null,
    };

    h.state.selectRows = [
      [{ id: 'membership-1', userId: 'user-1', portalId: 'portal-1' }],
      [releasedRound],
      [{ submission, result: opts.score === null ? null : { score: opts.score ?? '0', feedback: null } }],
      opts.questions,
    ];
    queueMarks({
      submission,
      questions: opts.questions,
      remark: opts.remark,
      manualScores: opts.manualScores,
    });
    queueRoundTotal(
      opts.pool ?? opts.questions.map((q) => ({ id: q.id, roundId: 'round-1', marks: q.marks })),
      noTotalRound
    );

    await renderPage();
  }

  it('renders a matching question pair by pair with its proportional credit', async () => {
    await renderWithQuestions({
      questions: [
        {
          id: 'q-match',
          prompt: MATCH_PROMPT,
          marks: 6,
          questionType: 'matching',
          options: MATCH_PAIRS,
          correctAnswer: null,
        },
      ],
      // The persisted aggregate: ONE payload under the BASE question uuid.
      answersJson: {
        'q-match': JSON.stringify({
          'q-match_0': 'Paris',
          'q-match_1': 'Rome',
          'q-match_2': 'Berlin',
        }),
      },
      score: '4',
    });

    // 2 of 3 pairs correct -> 4 of 6 marks (never all-or-nothing, never 0).
    const card = cardOf(MATCH_PROMPT);
    expect(within(card).getByText('4 / 6')).toBeInTheDocument();
    expect(within(card).getByText('Partly correct')).toBeInTheDocument();

    // Each correctly matched pair renders the response twice: once as the
    // student's choice and once as the correct match.
    expect(within(card).getByText('France')).toBeInTheDocument();
    expect(within(card).getAllByText('Paris')).toHaveLength(2);
    expect(within(card).getAllByText('Rome')).toHaveLength(2);
    expect(within(card).getByText('Spain')).toBeInTheDocument();
    expect(within(card).getByText('Berlin')).toBeInTheDocument(); // chosen, wrong
    expect(within(card).getByText('Madrid')).toBeInTheDocument(); // correct match
    // The correct-match column is labelled once per pair.
    expect(within(card).getAllByText('Correct match')).toHaveLength(3);
    // The header still shows the stored score out of the round total.
    expect(screen.getByText('Final Score')).toBeInTheDocument();
  });

  it('reassembles legacy per-pair answer keys so matching marks still render', async () => {
    await renderWithQuestions({
      questions: [
        {
          id: 'q-match',
          prompt: MATCH_PROMPT,
          marks: 6,
          questionType: 'matching',
          options: MATCH_PAIRS,
          correctAnswer: null,
        },
      ],
      // Legacy answers_json: one entry per pair, none under the base id.
      answersJson: {
        'q-match_0': 'Paris',
        'q-match_1': 'Rome',
        'q-match_2': 'Madrid',
      },
      score: '6',
    });

    const card = cardOf(MATCH_PROMPT);
    expect(within(card).getByText('6 / 6')).toBeInTheDocument();
    expect(within(card).getByText('Correct')).toBeInTheDocument();
  });

  it('shows every pair as unmatched rather than crashing on an absent answer', async () => {
    await renderWithQuestions({
      questions: [
        {
          id: 'q-match',
          prompt: MATCH_PROMPT,
          marks: 6,
          questionType: 'matching',
          options: MATCH_PAIRS,
          correctAnswer: null,
        },
      ],
      answersJson: {},
      score: '0',
    });

    const card = cardOf(MATCH_PROMPT);
    expect(within(card).getByText('0 / 6')).toBeInTheDocument();
    expect(within(card).getAllByText('No match selected')).toHaveLength(3);
  });

  it('marks free text from the educator score and says it is educator-marked', async () => {
    await renderWithQuestions({
      questions: [
        {
          id: 'q-1',
          prompt: 'Explain photosynthesis',
          marks: 4,
          questionType: 'free_text',
          options: null,
          correctAnswer: null,
        },
        {
          id: 'q-2',
          prompt: 'What is 2 + 2?',
          marks: 2,
          questionType: 'single_choice',
          options: ['3', '4'],
          correctAnswer: '4',
        },
      ],
      answersJson: { 'q-1': 'Light energy becomes chemical energy', 'q-2': '4' },
      score: '5',
      studentMembershipId: 'membership-1',
      manualScores: [{ questionId: 'q-1', manualScore: '3' }],
    });

    expect(within(cardOf('Explain photosynthesis')).getByText('3 / 4')).toBeInTheDocument();
    expect(within(cardOf('Explain photosynthesis')).getByText('Educator-marked')).toBeInTheDocument();
    expect(within(cardOf('What is 2 + 2?')).getByText('2 / 2')).toBeInTheDocument();
    // 3 (educator) + 2 (auto) = the stored score of 5, out of the pool total 6.
    expect(screen.getByText('5 / 6')).toBeInTheDocument();
  });

  it('flags free text that no educator has marked yet instead of calling it wrong', async () => {
    await renderWithQuestions({
      questions: [
        {
          id: 'q-1',
          prompt: 'Explain photosynthesis',
          marks: 4,
          questionType: 'free_text',
          options: null,
          correctAnswer: null,
        },
      ],
      answersJson: { 'q-1': 'Light energy becomes chemical energy' },
      score: '0',
    });

    const card = cardOf('Explain photosynthesis');
    expect(within(card).getByText('0 / 4')).toBeInTheDocument();
    expect(within(card).getByText('Awaiting educator')).toBeInTheDocument();
    expect(within(card).queryByText('Incorrect')).not.toBeInTheDocument();
    expect(within(card).getByText('Marked by your educator')).toBeInTheDocument();
  });

  it('lets a resolved remark override the auto-marked per-question score', async () => {
    await renderWithQuestions({
      questions: [
        {
          id: 'q-1',
          prompt: 'What is 2 + 2?',
          marks: 5,
          questionType: 'single_choice',
          options: ['3', '4'],
          correctAnswer: '4',
        },
      ],
      answersJson: { 'q-1': '3' }, // auto-marks to 0
      score: '5',
      remark: [{ status: 'resolved', questionMarks: { 'q-1': 5 } }],
    });

    const card = cardOf('What is 2 + 2?');
    expect(within(card).getByText('5 / 5')).toBeInTheDocument();
    expect(within(card).getByText('Correct')).toBeInTheDocument();
    // The remarked mark replaces the auto-marker's 0 for the wrong choice.
    expect(within(card).getByText('3')).toBeInTheDocument();
  });
});
