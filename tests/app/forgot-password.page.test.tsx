import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ForgotPasswordPage from '@/app/forgot-password/page';
import React from 'react';

// Mock framer-motion so it doesn't break tests or wait for animations
vi.mock('framer-motion', () => {
  const React = require('react');
  const Dummy = React.forwardRef((props: any, ref: any) => {
    const { initial, animate, transition, ...rest } = props;
    return <div ref={ref} {...rest} />;
  });
  return {
    motion: {
      div: Dummy,
    },
  };
});

// Mock next/navigation
const mockUseSearchParams = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

// Mock the action (hoisted so the vi.mock factory can reference it safely)
const { mockRequestPasswordReset } = vi.hoisted(() => ({
  mockRequestPasswordReset: vi.fn(),
}));
vi.mock('@/app/auth/actions', () => ({
  requestPasswordReset: mockRequestPasswordReset,
}));

// Mock react-dom useFormStatus
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    useFormStatus: () => ({ pending: false }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSearchParams.mockReturnValue(new URLSearchParams(''));
});

describe('ForgotPasswordPage', () => {
  it('renders the reset request form', () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByText('Reset your password')).toBeInTheDocument();
    expect(
      screen.getByText(/send you a link to choose a new one/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Send Reset Link' })
    ).toBeInTheDocument();
  });

  it('links back to the sign-in page', () => {
    render(<ForgotPasswordPage />);
    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link).toHaveAttribute('href', '/');
  });

  it('warns when the reset link was invalid or expired', () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('?resetLink=invalid')
    );
    render(<ForgotPasswordPage />);
    expect(
      screen.getByText(/reset link is invalid or has expired/i)
    ).toBeInTheDocument();
  });

  it('shows the success message after requesting a reset', async () => {
    mockRequestPasswordReset.mockResolvedValue({
      success:
        'If an account exists for that email, a password reset link is on its way. Please check your inbox (and your spam folder).',
    });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'teacher@example.com' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Send Reset Link' }).closest('form')!
    );

    await waitFor(() =>
      expect(
        screen.getByText(/reset link is on its way/i)
      ).toBeInTheDocument()
    );
    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(1);

    const submitted = mockRequestPasswordReset.mock.calls[0][0] as FormData;
    expect(submitted.get('email')).toBe('teacher@example.com');
  });

  it('shows the action error when the request fails', async () => {
    mockRequestPasswordReset.mockResolvedValue({
      error: 'Something went wrong while sending the reset email.',
    });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'teacher@example.com' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Send Reset Link' }).closest('form')!
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Something went wrong while sending the reset email/i)
      ).toBeInTheDocument()
    );
  });
});
