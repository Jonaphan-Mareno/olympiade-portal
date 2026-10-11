import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CreatePortalForm from '@/components/organiser/CreatePortalForm';
import type { PickedSchool } from '@/lib/schools/types';

// The Create Portal form shares the EducatorEmailsField with the invite
// flow: a school's educators can be typed in one at a time or bulk-added
// from a CSV, and every address must travel through school_teacherEmails_i
// when the form submits to the createPortal action.

const { mockCreatePortal, mockPush } = vi.hoisted(() => ({
  mockCreatePortal: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock('@/app/organiser/actions', () => ({
  createPortal: mockCreatePortal,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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
            name: 'Springfield High',
            type: 'high_school',
            externalId: 'ext-1',
          })
        }
      >
        pick-school-stub
      </button>
    ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCreatePortal.mockResolvedValue(undefined);
});

describe('CreatePortalForm', () => {
  it('submits manually typed and CSV-uploaded educator emails', async () => {
    const { container } = render(<CreatePortalForm />);

    fireEvent.change(screen.getByLabelText('Olympiad / Portal Name'), {
      target: { value: 'National Mathematics Olympiad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'pick-school-stub' }));

    // Manual entry first…
    fireEvent.change(screen.getByPlaceholderText('teacher@email.com'), {
      target: { value: 'Teacher@One.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('teacher@one.com')).toBeInTheDocument();

    // …then a CSV with a duplicate and a new address.
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(
      ['email\ntwo@school.edu\nteacher@one.com'],
      'teachers.csv',
      { type: 'text/csv' }
    );
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(await screen.findByText('two@school.edu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Portal' }));

    await waitFor(() => expect(mockCreatePortal).toHaveBeenCalledTimes(1));

    const formData = mockCreatePortal.mock.calls[0][0] as FormData;
    expect(formData.get('portalName')).toBe('National Mathematics Olympiad');
    expect(formData.get('schoolCount')).toBe('1');
    expect(formData.get('school_name_0')).toBe('Springfield High');
    expect(formData.get('school_type_0')).toBe('high_school');
    expect(formData.get('school_externalId_0')).toBe('ext-1');
    expect(formData.getAll('school_teacherEmails_0')).toEqual([
      'teacher@one.com',
      'two@school.edu',
    ]);
  });

  it('leaves CSV-added educators out until a school is picked', async () => {
    const { container } = render(<CreatePortalForm />);

    fireEvent.change(screen.getByLabelText('Olympiad / Portal Name'), {
      target: { value: 'Unfinished Portal' },
    });
    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['bulk@school.edu'], 'teachers.csv', { type: 'text/csv' })],
      },
    });
    expect(await screen.findByText('bulk@school.edu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Portal' }));

    await waitFor(() => expect(mockCreatePortal).toHaveBeenCalledTimes(1));

    const formData = mockCreatePortal.mock.calls[0][0] as FormData;
    expect(formData.get('schoolCount')).toBe('0');
    expect(formData.getAll('school_teacherEmails_0')).toEqual([]);
  });
});
