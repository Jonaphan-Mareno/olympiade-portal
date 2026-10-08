import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PublishReadinessPanel, {
  READINESS_CHANGED_EVENT,
} from '@/components/organiser/PublishReadinessPanel';
import { QUESTIONS_CHANGED_EVENT } from '@/components/organiser/QuestionBuilder';

// The panel is advisory: it runs the SAME pure checkers as the server action and
// surfaces a summary banner + per-question inline errors, exposes readiness to
// the parent (callback / window event) and can gate a submit button by id. These
// tests assert the render + readiness signalling, not the checker internals
// (which are covered directly in tests/domain).

const ok = () => screen.getByTestId('publish-readiness-panel').getAttribute('data-ok');

describe('PublishReadinessPanel', () => {
  it('reports ready for a fully-specified online pool that hits the target', () => {
    render(
      <PublishReadinessPanel
        deliveryMethod="online"
        targetTotal={10}
        pool={[{ id: 'a', prompt: 'Q', marks: 10, difficulty: 1 }]}
      />
    );

    expect(ok()).toBe('true');
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.getByTestId('readiness-summary').textContent).toContain(
      'reaches the 10-mark target'
    );
  });

  it('flags a missing difficulty as an inline per-question issue and reports not ready', () => {
    const onReady = vi.fn();
    render(
      <PublishReadinessPanel
        deliveryMethod="online"
        targetTotal={10}
        pool={[{ id: 'a', prompt: 'Q', marks: 10, difficulty: null }]}
        onReadinessChange={onReady}
      />
    );

    expect(ok()).toBe('false');
    expect(screen.getByText('Not ready to publish')).toBeInTheDocument();
    // The issue is keyed to the question, so it renders in the question list
    // labelled with its position in the pool.
    expect(screen.getByTestId('readiness-question-issues').textContent).toContain(
      'needs a difficulty'
    );
    expect(screen.getByTestId('readiness-question-issues').textContent).toContain(
      'Question 1'
    );
    // Readiness is pushed to the parent so it can gate the save/publish button.
    expect(onReady).toHaveBeenCalledWith(false);
  });

  it('flags an unreachable target in the summary and the general issues', () => {
    render(
      <PublishReadinessPanel
        deliveryMethod="online"
        targetTotal={7}
        pool={[
          { id: 'a', prompt: 'Q1', marks: 5, difficulty: 1 },
          { id: 'b', prompt: 'Q2', marks: 5, difficulty: 2 },
        ]}
      />
    );

    expect(ok()).toBe('false');
    expect(screen.getByTestId('readiness-summary').textContent).toContain(
      'not reachable'
    );
    expect(screen.getByTestId('readiness-general').textContent).toContain(
      'No balanced draw can hit exactly 7'
    );
  });

  it('treats a valid physical selection as ready (difficulty not required)', () => {
    render(
      <PublishReadinessPanel
        deliveryMethod="paper"
        pool={[{ id: 'a', prompt: 'Q', marks: 5 }]}
        selectedIds={['a']}
      />
    );

    expect(ok()).toBe('true');
    expect(screen.getByTestId('readiness-summary').textContent).toContain(
      'Selected 1 question'
    );
  });

  it('requires a physical selection for a paper round with a pool', () => {
    render(
      <PublishReadinessPanel
        deliveryMethod="paper"
        pool={[{ id: 'a', prompt: 'Q', marks: 5 }]}
        selectedIds={[]}
      />
    );

    expect(ok()).toBe('false');
    expect(screen.getByTestId('readiness-general').textContent).toContain(
      'Select the questions'
    );
  });

  it('disables the parent submit button while not ready', () => {
    render(
      <div>
        <button id="save-round-submit">Save round</button>
        <PublishReadinessPanel
          deliveryMethod="online"
          targetTotal={10}
          pool={[{ id: 'a', prompt: 'Q', marks: 10, difficulty: null }]}
          submitButtonId="save-round-submit"
        />
      </div>
    );

    const btn = document.getElementById('save-round-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('re-checks live when the builder broadcasts a questions change', () => {
    const seen: boolean[] = [];
    const listener = (e: Event) =>
      seen.push((e as CustomEvent).detail?.ok as boolean);
    window.addEventListener(READINESS_CHANGED_EVENT, listener as EventListener);

    render(<PublishReadinessPanel deliveryMethod="online" targetTotal={10} pool={[]} />);
    // An empty pool is not ready.
    expect(ok()).toBe('false');

    // The builder pushes a fully-specified question -> becomes ready.
    act(() => {
      window.dispatchEvent(
        new CustomEvent(QUESTIONS_CHANGED_EVENT, {
          detail: { questions: [{ id: 'a', prompt: 'Q', marks: 10, difficulty: 1 }] },
        })
      );
    });

    expect(ok()).toBe('true');
    expect(seen).toContain(true);
    window.removeEventListener(READINESS_CHANGED_EVENT, listener as EventListener);
  });
});
