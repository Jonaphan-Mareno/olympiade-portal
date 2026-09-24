import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import RoundTabs from '@/app/(student)/results/[portalId]/RoundTabs';

// A student's released result must show the raw mark out of the round's
// total AND the percentage; rounds without a computable total (no questions
// in the bank) fall back to the raw mark alone.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ portalId: 'portal-1' }),
}));

type RoundOverrides = Record<string, unknown>;

function roundWithResult(
  score: number | null,
  maxScore: number | null,
  overrides: RoundOverrides = {}
) {
  return {
    id: 'round-1',
    name: 'Round 1',
    opensAt: null,
    closesAt: null,
    qualifyingThreshold: null,
    deliveryMethod: 'online' as const,
    durationMinutes: 60,
    sittingId: null,
    sittingStatus: 'submitted' as const,
    state: 'released' as const,
    myResult: {
      submitted: true,
      score,
      maxScore,
      feedback: null,
    },
    ...overrides,
  };
}

describe('RoundTabs result display', () => {
  it('shows the raw mark out of the total and the percentage', () => {
    render(<RoundTabs rounds={[roundWithResult(18, 25)]} />);

    expect(screen.getByText('18 / 25')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
  });

  it('shows the raw mark alone when the round has no total marks', () => {
    render(<RoundTabs rounds={[roundWithResult(14, null)]} />);

    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('rounds the percentage to a whole number', () => {
    // 1/3 = 33.33…%
    render(<RoundTabs rounds={[roundWithResult(1, 3)]} />);

    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('shows the feedback underneath the mark', () => {
    render(
      <RoundTabs
        rounds={[
          roundWithResult(18, 25, {
            myResult: {
              submitted: true,
              score: 18,
              maxScore: 25,
              feedback: 'Auto-marked: 18 / 25',
            },
          }),
        ]}
      />
    );

    expect(screen.getByText(/Auto-marked: 18 \/ 25/)).toBeInTheDocument();
  });
});
