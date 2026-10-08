import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import QuestionBuilder from '@/components/organiser/QuestionBuilder';

describe('QuestionBuilder', () => {
  it('renders with one default question', () => {
    render(<QuestionBuilder />);
    expect(screen.getByText('Question 1')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('+ Add Another Question')).toBeInTheDocument();
  });

  it('can add a new question', () => {
    render(<QuestionBuilder />);
    fireEvent.click(screen.getByText('+ Add Another Question'));
    expect(screen.getByText('Question 1')).toBeInTheDocument();
    expect(screen.getByText('Question 2')).toBeInTheDocument();
  });

  it('can remove a question', () => {
    render(<QuestionBuilder />);
    fireEvent.click(screen.getByText('+ Add Another Question'));
    const removeButtons = screen.getAllByText('Remove');
    fireEvent.click(removeButtons[0]);
    // The second question should now be relabeled as Question 1
    expect(screen.queryByText('Question 2')).not.toBeInTheDocument();
    expect(screen.getByText('Question 1')).toBeInTheDocument();
  });

  it('can add an option to a single choice question', () => {
    render(<QuestionBuilder />);
    fireEvent.click(screen.getByText('+ Add Option'));
    const inputs = screen.getAllByPlaceholderText(/Option/);
    expect(inputs).toHaveLength(2);
  });

  it('hides the difficulty select unless requireDifficulty is set (physical-only pools)', () => {
    const { rerender } = render(<QuestionBuilder />);
    expect(screen.queryByLabelText('Difficulty')).not.toBeInTheDocument();

    rerender(<QuestionBuilder requireDifficulty />);
    expect(screen.getByLabelText('Difficulty')).toBeInTheDocument();
  });

  it('constrains the marks input to whole numbers of 1 or more', () => {
    const { container } = render(<QuestionBuilder />);
    const marks = container.querySelector('input[type="number"]')!;
    expect(marks.getAttribute('min')).toBe('1');
    expect(marks.getAttribute('step')).toBe('1');
  });

  it('serializes difficulty into the hidden payload (blank -> null, set -> number)', () => {
    const { container } = render(<QuestionBuilder requireDifficulty />);
    const hidden = container.querySelector(
      'input[name="questionsData"]'
    ) as HTMLInputElement;

    // A freshly added question has no difficulty yet -> serialized as null.
    expect(JSON.parse(hidden.value)[0].difficulty).toBeNull();

    fireEvent.change(screen.getByLabelText('Difficulty'), {
      target: { value: '3' },
    });
    expect(JSON.parse(hidden.value)[0].difficulty).toBe(3);
  });
});
