import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SubmitButton } from '@/components/SubmitButton';

// Mock useFormStatus
const mockUseFormStatus = vi.fn();
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    useFormStatus: () => mockUseFormStatus(),
  };
});

describe('SubmitButton', () => {
  it('renders children when not pending', () => {
    mockUseFormStatus.mockReturnValue({ pending: false });
    render(<SubmitButton>Submit Data</SubmitButton>);
    expect(screen.getByText('Submit Data')).toBeInTheDocument();
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('renders pending text and disables button when pending', () => {
    mockUseFormStatus.mockReturnValue({ pending: true });
    render(<SubmitButton pendingText="Please wait...">Submit Data</SubmitButton>);
    expect(screen.getByText('Please wait...')).toBeInTheDocument();
    expect(screen.queryByText('Submit Data')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });
  
  it('defaults to "Submitting..." if pendingText is not provided', () => {
    mockUseFormStatus.mockReturnValue({ pending: true });
    render(<SubmitButton>Submit Data</SubmitButton>);
    expect(screen.getByText('Submitting...')).toBeInTheDocument();
  });
});
