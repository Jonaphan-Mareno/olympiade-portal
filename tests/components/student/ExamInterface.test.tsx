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
