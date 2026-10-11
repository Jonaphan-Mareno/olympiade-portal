import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InviteStudentsForm from '@/components/educator/InviteStudentsForm';

// The educator's student-invite form: manual one-at-a-time entry plus a CSV
// bulk-add parsed in the browser (shared mergeCsvEmails logic with the
// organiser's EducatorEmailsField). Every address goes to inviteStudents as a
// repeated `studentEmails` field.

const { mockInviteStudents } = vi.hoisted(() => ({
  mockInviteStudents: vi.fn(),
}));

vi.mock('@/app/educator/actions', () => ({
  inviteStudents: mockInviteStudents,
}));

function renderForm() {
  return render(
    <InviteStudentsForm portalId="portal-1" schoolId="school-1" schoolName="Riverside High" />
  );
}

function addManual(email: string) {
  fireEvent.change(screen.getByPlaceholderText('student@email.com'), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

function uploadCsv(container: HTMLElement, content: string) {
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([content], 'students.csv', { type: 'text/csv' });
  fireEvent.change(fileInput, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInviteStudents.mockResolvedValue({ success: true, count: 3, skipped: [] });
});

describe('InviteStudentsForm', () => {
  it('adds every unique email from a multi-email CSV', async () => {
    const { container } = renderForm();

    uploadCsv(
      container,
      'Name,Email\nTom,Tom@Mail.com\nAmy,amy@mail.com\nTom again,tom@mail.com'
    );

    expect(await screen.findByText('Added 2 emails from the CSV.')).toBeInTheDocument();
    expect(screen.getByText('tom@mail.com')).toBeInTheDocument();
    expect(screen.getByText('amy@mail.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite 2 students' })).toBeInTheDocument();
  });

  it('skips CSV emails already added manually and reports them', async () => {
    const { container } = renderForm();

    addManual('jane@mail.com');
    uploadCsv(container, 'email\njane@mail.com\nbob@mail.com');

    expect(
      await screen.findByText('Added 1 email from the CSV (1 duplicate skipped).')
    ).toBeInTheDocument();
    expect(screen.getAllByText('jane@mail.com')).toHaveLength(1);
    expect(screen.getByText('bob@mail.com')).toBeInTheDocument();
  });

  it('shows an error for a CSV with no email addresses', async () => {
    const { container } = renderForm();

    uploadCsv(container, 'name,grade\nJane,10');

    expect(
      await screen.findByText('No email addresses were found in that file.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite 0 students' })).toBeDisabled();
  });

  it('submits manual and CSV emails as studentEmails and shows the result banner', async () => {
    mockInviteStudents.mockResolvedValue({
      success: true,
      count: 2,
      skipped: [{ email: 'amy@mail.com', reason: 'is already registered for your school' }],
    });
    const { container } = renderForm();

    addManual('manual@mail.com');
    uploadCsv(container, 'Tom,tom@mail.com\nAmy,amy@mail.com');
    await screen.findByText('Added 2 emails from the CSV.');

    fireEvent.click(screen.getByRole('button', { name: 'Invite 3 students' }));

    await waitFor(() => expect(mockInviteStudents).toHaveBeenCalledTimes(1));
    const formData = mockInviteStudents.mock.calls[0][0] as FormData;
    expect(formData.get('portalId')).toBe('portal-1');
    expect(formData.get('schoolId')).toBe('school-1');
    expect(formData.getAll('studentEmails')).toEqual([
      'manual@mail.com',
      'tom@mail.com',
      'amy@mail.com',
    ]);

    expect(await screen.findByText('2 students invited successfully!')).toBeInTheDocument();
    expect(screen.getByText(/amy@mail.com is already registered for your school/)).toBeInTheDocument();
    // The list is cleared and the stale CSV note dropped after a successful send.
    expect(screen.queryByText('Added 2 emails from the CSV.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite 0 students' })).toBeInTheDocument();
  });

  it('still supports Enter-to-add and chip removal', () => {
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('student@email.com'), {
      target: { value: 'Enter@Mail.com' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('student@email.com'), { key: 'Enter' });
    expect(screen.getByText('enter@mail.com')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(screen.queryByText('enter@mail.com')).not.toBeInTheDocument();
  });
});
