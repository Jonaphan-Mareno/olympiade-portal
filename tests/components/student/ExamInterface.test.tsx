import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from 'vitest';
import ExamInterface from '@/components/student/ExamInterface';

beforeAll(() => {
  global.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
});

vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
));

const mockQuestions: any[] = [
  {
    id: 'q1',
    questionType: 'single_choice',
    prompt: 'What is 2+2?',
    marks: 1,
    options: ['3', '4', '5'],
  },
];

// Far enough in the future that the 60-minute relative limit (not the round
// close) governs the countdown, preserving these tests' original intent.
const mockClosesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) { return store[key] || null; },
    setItem(key: string, value: string) { store[key] = value.toString(); },
    removeItem(key: string) { delete store[key]; },
    clear() { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('ExamInterface', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    // Re-establish the default stubbed response so a test that overrides the
    // implementation (e.g. with a deferred promise) cannot leak into others.
    (fetch as Mock).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );
  });

  it('renders exam title and questions', async () => {
    render(
      <ExamInterface
        sittingId="sitting1"
        durationMinutes={60}
        startedAt={new Date().toISOString()}
        closesAt={mockClosesAt}
        initialAnswers={{}}
        questions={mockQuestions}
        testTitle="Math Exam"
      />
    );
    
    expect(screen.getByText('Math Exam')).toBeInTheDocument();
    
    // Wait for hydration
    await waitFor(() => {
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    });
  });

  it('handles answering a single choice question', async () => {
    render(
      <ExamInterface
        sittingId="sitting1"
        durationMinutes={60}
        startedAt={new Date().toISOString()}
        closesAt={mockClosesAt}
        initialAnswers={{}}
        questions={mockQuestions}
        testTitle="Math Exam"
      />
    );

    // Wait for hydration
    await waitFor(() => {
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    });

    const option4 = screen.getByLabelText('4');
    fireEvent.click(option4);

    expect(option4).toBeChecked();
    
    // Check if fetch was called to save the answer
    expect(fetch).toHaveBeenCalledWith('/api/student/sitting/save', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"answerValue":"4"'),
    }));
  });

  it('requires confirmation in a dialog before finishing the attempt', async () => {
    let resolveSubmit!: (value: unknown) => void;
    (fetch as Mock).mockImplementation((url: string) =>
      url === '/api/student/sitting/submit'
        ? new Promise<unknown>((resolve) => {
            resolveSubmit = resolve;
          })
        : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );

    render(
      <ExamInterface
        sittingId="sitting1"
        durationMinutes={60}
        startedAt={new Date().toISOString()}
        closesAt={mockClosesAt}
        initialAnswers={{}}
        questions={mockQuestions}
        testTitle="Math Exam"
      />
    );

    // Wait for hydration
    await waitFor(() => {
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    });

    // No dialog until the finish button is clicked.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish attempt...' }));
    expect(screen.getByText('Submit your attempt?')).toBeInTheDocument();

    // Cancelling closes the dialog without submitting anything.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/student/sitting/submit',
      expect.anything()
    );

    // Confirming submits the attempt and locks the dialog while it is in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Finish attempt...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit attempt' }));

    const busyConfirm = await screen.findByRole('button', { name: 'Submitting…' });
    expect(busyConfirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await act(async () => {
      resolveSubmit({ ok: true, json: () => Promise.resolve({}) });
    });

    // On success the attempt is finalised and the view switches state.
    await waitFor(() => {
      expect(screen.getByText('Submitting attempt...')).toBeInTheDocument();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/student/sitting/submit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sittingId: 'sitting1' }),
      })
    );
  });
});

// Matching answers are stored server-side as ONE aggregated JSON payload under
// the base question uuid (question_id is a uuid column), while the pair selects
// in this component are keyed `${questionId}_${pairIndex}`. Resuming an attempt
// must expand one shape into the other in both directions, or every saved match
// renders as "Choose match..." and is silently lost.
describe('ExamInterface matching questions', () => {
  const Q_MATCH = '3f2b8c1e-6d4a-4f9b-9c2e-8a1d5e7f0b34';
  const PAIRS = [
    { premise: 'France', response: 'Paris' },
    { premise: 'Italy', response: 'Rome' },
    { premise: 'Spain', response: 'Madrid' },
  ];
  const matchingQuestions: any[] = [
    {
      id: Q_MATCH,
      questionType: 'matching',
      prompt: 'Match each country to its capital',
      marks: 6,
      options: PAIRS,
    },
  ];

  const renderInterface = (initialAnswers: Record<string, string>) =>
    render(
      <ExamInterface
        sittingId="sitting1"
        durationMinutes={60}
        startedAt={new Date().toISOString()}
        closesAt={mockClosesAt}
        initialAnswers={initialAnswers}
        questions={matchingQuestions}
        testTitle="Math Exam"
      />
    );

  /** The three pair selects, in premise order. */
  const pairSelects = () =>
    screen.getAllByRole('combobox') as unknown as HTMLSelectElement[];

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    (fetch as Mock).mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );
  });

  it('expands the server aggregate back into the per-pair selects', async () => {
    renderInterface({
      [Q_MATCH]: JSON.stringify({
        [`${Q_MATCH}_0`]: 'Paris',
        [`${Q_MATCH}_1`]: 'Rome',
      }),
    });

    await waitFor(() => expect(pairSelects()).toHaveLength(3));

    const [france, italy, spain] = pairSelects();
    expect(france.value).toBe('Paris');
    expect(italy.value).toBe('Rome');
    // The unanswered pair stays empty rather than showing the raw JSON blob.
    expect(spain.value).toBe('');
  });

  it('restores the aggregate saved in the offline localStorage copy', async () => {
    window.localStorage.setItem(
      'exam_answers_sitting1',
      JSON.stringify({ [Q_MATCH]: JSON.stringify({ [`${Q_MATCH}_2`]: 'Madrid' }) })
    );

    renderInterface({});

    await waitFor(() => expect(pairSelects()[2].value).toBe('Madrid'));
    expect(pairSelects()[0].value).toBe('');
  });

  it('leaves a non-aggregate answer alone instead of expanding it', async () => {
    renderInterface({ [Q_MATCH]: 'not json' });

    await waitFor(() => expect(pairSelects()).toHaveLength(3));
    expect(pairSelects().every((s) => s.value === '')).toBe(true);
  });

  it('posts each pair under its composite key so the server can aggregate it', async () => {
    renderInterface({});

    await waitFor(() => expect(pairSelects()).toHaveLength(3));

    fireEvent.change(pairSelects()[1], { target: { value: 'Rome' } });

    expect(fetch).toHaveBeenCalledWith(
      '/api/student/sitting/save',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sittingId: 'sitting1',
          questionId: `${Q_MATCH}_1`,
          answerValue: 'Rome',
        }),
      })
    );
    // Once the save succeeds the pair leaves the offline queue — it is on the
    // server now — while the select keeps showing the student's choice.
    await waitFor(() => {
      const local = JSON.parse(window.localStorage.getItem('exam_answers_sitting1') ?? '{}');
      expect(local[`${Q_MATCH}_1`]).toBeUndefined();
    });
    expect(pairSelects()[1].value).toBe('Rome');
  });

  it('keeps the other pairs when one is changed', async () => {
    renderInterface({
      [Q_MATCH]: JSON.stringify({ [`${Q_MATCH}_0`]: 'Paris', [`${Q_MATCH}_1`]: 'Rome' }),
    });

    await waitFor(() => expect(pairSelects()).toHaveLength(3));

    fireEvent.change(pairSelects()[1], { target: { value: 'Madrid' } });

    await waitFor(() => expect(pairSelects()[1].value).toBe('Madrid'));
    expect(pairSelects()[0].value).toBe('Paris');
  });
});
