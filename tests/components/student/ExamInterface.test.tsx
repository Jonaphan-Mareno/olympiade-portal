import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExamInterface from '@/components/student/ExamInterface';

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

describe('ExamInterface', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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
});
