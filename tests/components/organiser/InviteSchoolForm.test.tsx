import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InviteSchoolForm from '@/app/organiser/olympiads/[olympiadId]/invite/InviteSchoolForm';
import type { PickedSchool } from '@/lib/schools/types';

// The "invite more schools" form (after a portal exists) shares the
// EducatorEmailsField with the Create Portal form — manual typing plus CSV
// bulk-add — and must submit every address through school_teacherEmails_i
// to the sendInvitations action.

const { mockSendInvitations } = vi.hoisted(() => ({
  mockSendInvitations: vi.fn(),
}));

vi.mock('@/app/organiser/olympiads/[olympiadId]/invite/actions', () => ({
  sendInvitations: mockSendInvitations,
}));

// Stands in for the school picker so the test can pick a school directly;
// like the real one it swaps the input for the completed selection.
vi.mock('@/components/schools/SchoolPicker', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: PickedSchool | null;
    onChange: (school: PickedSchool) => void;
  }) =>
    value ? (
      <div>{value.name}</div>
    ) : (
      <button
        type="button"
        onClick={() =>
          onChange({
            name: 'Riverside High',
            type: 'high_school',
            externalId: 'ext-2',
          })
        }
      >
        pick-school-stub
      </button>
    ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSendInvitations.mockResolvedValue(undefined);
});

describe('InviteSchoolForm', () => {
  it('submits manually typed and CSV-uploaded educator emails', async () => {
    const { container } = render(<InviteSchoolForm portalId="portal-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'pick-school-stub' }));

    // Manual entry first…
    fireEvent.change(screen.getByPlaceholderText('educator@school.edu'), {
      target: { value: 'manual@school.edu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('manual@school.edu')).toBeInTheDocument();

    // …then a CSV with two more addresses.
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(
      ['Name,Email\nTom,tom@school.edu\nAmy,amy@school.edu'],
      'educators.csv',
      { type: 'text/csv' }
    );
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByText('Added 2 emails from the CSV.');

    fireEvent.click(screen.getByRole('button', { name: 'Send Invitations' }));

    await waitFor(() => expect(mockSendInvitations).toHaveBeenCalledTimes(1));

    const [portalId, formData] = mockSendInvitations.mock.calls[0] as [
      string,
      FormData,
    ];
    expect(portalId).toBe('portal-1');
    expect(formData.get('schoolCount')).toBe('1');
    expect(formData.get('school_name_0')).toBe('Riverside High');
    expect(formData.get('school_type_0')).toBe('high_school');
    expect(formData.get('school_externalId_0')).toBe('ext-2');
    expect(formData.getAll('school_teacherEmails_0')).toEqual([
      'manual@school.edu',
      'tom@school.edu',
      'amy@school.edu',
    ]);
  });

  it('shows the action error and keeps the entries when it fails', async () => {
    mockSendInvitations.mockResolvedValue({
      error: 'The olympiad could not be found.',
    });
    render(<InviteSchoolForm portalId="portal-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'pick-school-stub' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitations' }));

    await waitFor(() =>
      expect(
        screen.getByText('The olympiad could not be found.')
      ).toBeInTheDocument()
    );
    expect(screen.getByText('Riverside High')).toBeInTheDocument();
  });
});
