import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OrganisationApplicationForm from '@/components/OrganisationApplicationForm';
import { submitOrganiserApplication } from '@/app/organiser/actions';

// Mock server action
vi.mock('@/app/organiser/actions', () => ({
  submitOrganiserApplication: vi.fn(),
}));

describe('OrganisationApplicationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders closed initially', () => {
    render(<OrganisationApplicationForm />);
    expect(screen.getByText('Submit organiser application')).toBeInTheDocument();
    expect(screen.queryByLabelText('Organisation Name')).not.toBeInTheDocument();
  });

  it('opens form when clicked', () => {
    render(<OrganisationApplicationForm />);
    fireEvent.click(screen.getByText('Submit organiser application'));
    expect(screen.getByLabelText('Organisation Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Purpose')).toBeInTheDocument();
  });

  it('closes form when cancel is clicked', () => {
    render(<OrganisationApplicationForm />);
    fireEvent.click(screen.getByText('Submit organiser application'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByLabelText('Organisation Name')).not.toBeInTheDocument();
  });
});
