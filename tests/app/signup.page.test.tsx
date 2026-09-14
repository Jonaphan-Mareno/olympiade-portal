import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SignupPage from '@/app/signup/page';
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

// Mock the action
vi.mock('@/app/auth/actions', () => ({
  signup: vi.fn(),
}));

// Mock react-dom useFormStatus
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    useFormStatus: () => ({ pending: false }),
  };
});

describe('SignupPage', () => {
  it('renders standard signup form when no token is present', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams(''));
    render(<SignupPage />);
    expect(screen.getByText('Apply as an Organiser')).toBeInTheDocument();
    expect(
      screen.getByText('Register to manage and run your academic olympiads.')
    ).toBeInTheDocument();
    expect(screen.getByText('Sign Up as Organiser')).toBeInTheDocument();
  });

  it('renders invite claim form when token is present', () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('?inviteToken=123')
    );
    render(<SignupPage />);
    expect(screen.getByText('Claim Your Account')).toBeInTheDocument();
    expect(
      screen.getByText('You have been invited to join an Olympiad.')
    ).toBeInTheDocument();
    expect(screen.getByText('Claim Account')).toBeInTheDocument();
  });
});
