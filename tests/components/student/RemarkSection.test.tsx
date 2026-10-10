import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(student)/results/scores/[submissionId]/actions', () => ({
  requestStudentRemark: vi.fn(),
  withdrawStudentRemark: vi.fn(),
}));

import RemarkSection from '@/app/(student)/results/scores/[submissionId]/RemarkSection';

const pending = {
  id: 'remark-1',
  status: 'pending' as const,
  reason: 'Wrong question picked',
  questionRefs: 'Q3',
  pins: null,
  previousScore: '10',
  newScore: null,
  responseNote: null,
};
const eligible = { eligible: true as const, closesAt: new Date('2026-09-15T00:00:00Z'), attemptsLeft: 1 };
const notEligible = { eligible: false as const, reason: 'Your remark request is still being reviewed.' };

describe('RemarkSection attempts', () => {
  it('offers to withdraw a pending request and says one request is left', () => {
    render(
      <RemarkSection submissionId="sub-1" remark={pending} eligibility={notEligible} attemptsUsed={1} />
    );
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeInTheDocument();
    expect(screen.getByText(/You can then submit a corrected one/)).toBeInTheDocument();
    expect(screen.getByTestId('remark-attempts')).toHaveTextContent(
      'You can request a remark up to 2 times for this paper (a withdrawn request counts). You have 1 of 2 left.'
    );
  });

  it('warns that withdrawing the last request leaves none', () => {
    render(
      <RemarkSection submissionId="sub-1" remark={pending} eligibility={notEligible} attemptsUsed={2} />
    );
    expect(screen.getByText(/This was your last request/)).toBeInTheDocument();
    expect(screen.getByTestId('remark-attempts')).toHaveTextContent('You have used all your requests.');
  });

  it('offers a new request after a withdrawal', () => {
    render(
      <RemarkSection
        submissionId="sub-1"
        remark={null}
        eligibility={eligible}
        attemptsUsed={1}
        lastWithdrawn
      />
    );
    expect(screen.getByText('Request another remark?')).toBeInTheDocument();
    expect(screen.getByText(/You withdrew your last request/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request Remark' })).toBeInTheDocument();
  });

  it('shows the outcome and still offers the second attempt', () => {
    render(
      <RemarkSection
        submissionId="sub-1"
        remark={{ ...pending, status: 'resolved', newScore: '10', responseNote: 'Confirmed.' }}
        eligibility={eligible}
        attemptsUsed={1}
      />
    );
    expect(screen.getByText('Your mark was confirmed at 10.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw request' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Request Remark' })).toBeInTheDocument();
  });
});
