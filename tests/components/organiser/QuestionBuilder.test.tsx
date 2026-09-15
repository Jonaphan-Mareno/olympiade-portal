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
});
