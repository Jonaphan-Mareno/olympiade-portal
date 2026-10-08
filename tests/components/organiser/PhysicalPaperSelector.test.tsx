import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PhysicalPaperSelector from '@/components/organiser/PhysicalPaperSelector';

// The selector is the organiser's ordered physical-paper picker: a checkbox list
// over the (non-blank) pool, a running total that turns green on the target, and
// up/down reordering. It emits the ordered id array into a hidden
// `selectedQuestionIds` input, which is what the round action persists.

const POOL = [
  { id: 'a', prompt: 'Q1', type: 'single_choice', marks: 5 },
  { id: 'b', prompt: 'Q2', type: 'single_choice', marks: 5 },
];

describe('PhysicalPaperSelector', () => {
  it('shows a running total that turns green when it equals the target', () => {
    render(<PhysicalPaperSelector pool={POOL} targetTotalMarks={10} />);

    const readout = screen.getByTestId('selected-total');
    expect(readout.textContent).toContain('Selected total: 0 marks');
    expect(readout.parentElement!.className).not.toContain('bg-green-50');

    fireEvent.click(screen.getByLabelText('Select Q1'));
    fireEvent.click(screen.getByLabelText('Select Q2'));

    const after = screen.getByTestId('selected-total');
    expect(after.textContent).toContain('Selected total: 10 marks');
    expect(after.parentElement!.className).toContain('bg-green-50');
  });

  it('reorders with the up/down buttons and emits an ordered hidden payload', () => {
    const { container } = render(<PhysicalPaperSelector pool={POOL} />);
    const hidden = () =>
      JSON.parse(
        (
          container.querySelector(
            'input[name="selectedQuestionIds"]'
          ) as HTMLInputElement
        ).value
      );

    fireEvent.click(screen.getByLabelText('Select Q1'));
    fireEvent.click(screen.getByLabelText('Select Q2'));
    expect(hidden()).toEqual(['a', 'b']);

    // Rows render in pool order (a then b), so index 1 is question 'b'.
    fireEvent.click(screen.getAllByLabelText('Move up')[1]); // b up -> b, a
    expect(hidden()).toEqual(['b', 'a']);

    fireEvent.click(screen.getAllByLabelText('Move down')[1]); // b down -> a, b
    expect(hidden()).toEqual(['a', 'b']);
  });

  it('starts from the persisted selection and keeps the payload in sync', () => {
    const { container } = render(
      <PhysicalPaperSelector pool={POOL} initialSelected={['b']} />
    );
    const hidden = container.querySelector(
      'input[name="selectedQuestionIds"]'
    ) as HTMLInputElement;

    expect(JSON.parse(hidden.value)).toEqual(['b']);
    expect(screen.getByTestId('selected-total').textContent).toContain(
      'Selected total: 5 marks'
    );

    // Unticking removes it from the ordered payload.
    fireEvent.click(screen.getByLabelText('Select Q2'));
    expect(JSON.parse(hidden.value)).toEqual([]);
  });

  it('ignores blank builder placeholders so they cannot be printed', () => {
    render(
      <PhysicalPaperSelector
        pool={[
          { id: 'a', prompt: 'Q1', type: 'single_choice', marks: 5 },
          { id: 'blank', prompt: '', type: 'single_choice', marks: '' },
        ]}
      />
    );

    // Only the question with a prompt is selectable.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByLabelText('Select Q1')).toBeInTheDocument();
  });
});
