import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AddEducatorButton from '@/app/organiser/olympiads/[olympiadId]/AddEducatorButton';

// The button opens a dialog for inviting more educators to a school that is
// already participating; the chips build the teacherEmails form entries the
// addEducators action consumes.

const { mockAddEducators } = vi.hoisted(() => ({
  mockAddEducators: vi.fn(),
}));

vi.mock('@/app/organiser/olympiads/[olympiadId]/actions', () => ({
  addEducators: mockAddEducators,
  deleteOlympiad: vi.fn(),
}));

function renderButton() {
  return render(
    <AddEducatorButton
      portalId="portal-1"
      schoolId="school-1"
      schoolName="Springfield High"
    />
  );
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: '+ Add Educator' }));
  return screen.getByRole('dialog');
}

async function addEmail(email: string) {
  fireEvent.change(screen.getByPlaceholderText('educator@school.edu'), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAddEducators.mockResolvedValue(undefined);
});

describe('AddEducatorButton', () => {
  it('renders the button and hides the dialog until clicked', () => {
    renderButton();

    expect(
      screen.getByRole('button', { name: '+ Add Educator' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a dialog naming the school', () => {
    renderButton();

    openDialog();

    expect(
      screen.getByText('Add educators to Springfield High')
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('educator@school.edu')
    ).toBeInTheDocument();
  });

  it('closes via Escape', () => {
    renderButton();
    const dialog = openDialog();

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('builds email chips and keeps submit disabled until one exists', () => {
    renderButton();
    openDialog();

    const submit = screen.getByRole('button', {
      name: 'Send Invitations',
    }) as HTMLButtonElement;
    expect(submit).toBeDisabled();

    addEmail('jon@teacher.com');

    expect(screen.getByText('jon@teacher.com')).toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it('ignores duplicate emails', () => {
    renderButton();
    openDialog();

    addEmail('jon@teacher.com');
    addEmail('jon@teacher.com');

    expect(screen.getAllByText('jon@teacher.com')).toHaveLength(1);
  });

  it('submits the emails to the action with portal and school ids', async () => {
    renderButton();
    openDialog();

    await addEmail('jon@teacher.com');
    await addEmail('tea@cher.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitations' }));

    await waitFor(() => expect(mockAddEducators).toHaveBeenCalledTimes(1));

    const [portalId, schoolId, formData] = mockAddEducators.mock.calls[0];
    expect(portalId).toBe('portal-1');
    expect(schoolId).toBe('school-1');
    expect(formData.getAll('teacherEmails')).toEqual([
      'jon@teacher.com',
      'tea@cher.com',
    ]);
  });

  it('closes the dialog when the action succeeds', async () => {
    renderButton();
    openDialog();

    await addEmail('jon@teacher.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitations' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });

  it('shows the action error and stays open when it fails', async () => {
    mockAddEducators.mockResolvedValue({
      error: 'This school is not part of the olympiad.',
    });
    renderButton();
    openDialog();

    await addEmail('jon@teacher.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitations' }));

    await waitFor(() =>
      expect(
        screen.getByText('This school is not part of the olympiad.')
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
