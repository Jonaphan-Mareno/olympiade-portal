import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import EducatorEmailsField from '@/components/organiser/EducatorEmailsField';

// Shared educator email-list field used by the Create Portal form and the
// "invite more schools" form: manual typing stays available, and a CSV can
// be bulk-added. The CSV is parsed in the browser — these tests drive the
// file input directly to prove the merge/skip behaviour without any server.

function Harness({ initial = [] }: { initial?: string[] }) {
  const [emails, setEmails] = useState(initial);
  return (
    <EducatorEmailsField
      emails={emails}
      onChange={setEmails}
      inputClassName="test-input"
      buttonClassName="test-btn"
    />
  );
}

function typeEmail(email: string) {
  fireEvent.change(screen.getByPlaceholderText('educator@school.edu'), {
    target: { value: email },
  });
}

function addEmail(email: string) {
  typeEmail(email);
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

function uploadCsv(container: HTMLElement, content: string) {
  const fileInput = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  const file = new File([content], 'teachers.csv', { type: 'text/csv' });
  fireEvent.change(fileInput, { target: { files: [file] } });
}

describe('EducatorEmailsField', () => {
  it('adds a manually typed email as a chip, lower-cased', () => {
    render(<Harness />);

    addEmail('Teacher@School.EDU');

    expect(screen.getByText('teacher@school.edu')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Upload CSV' })
    ).toBeInTheDocument();
  });

  it('adds an email with the Enter key', () => {
    render(<Harness />);

    typeEmail('enter@school.edu');
    fireEvent.keyDown(screen.getByPlaceholderText('educator@school.edu'), {
      key: 'Enter',
    });

    expect(screen.getByText('enter@school.edu')).toBeInTheDocument();
  });

  it('ignores duplicates and addresses without an @', () => {
    render(<Harness />);

    addEmail('jon@school.edu');
    addEmail('jon@school.edu');
    addEmail('not-an-email');

    expect(screen.getAllByText('jon@school.edu')).toHaveLength(1);
    expect(screen.queryByText('not-an-email')).not.toBeInTheDocument();
  });

  it('removes a chip again', () => {
    render(<Harness />);

    addEmail('jon@school.edu');
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove jon@school.edu' })
    );

    expect(screen.queryByText('jon@school.edu')).not.toBeInTheDocument();
  });

  it('merges a CSV upload into the list and reports the result', async () => {
    const { container } = render(<Harness initial={['jane@school.edu']} />);

    uploadCsv(
      container,
      'Name,Email\nTom,tom@school.edu\nJane,jane@school.edu\nAmy,amy@school.edu'
    );

    expect(await screen.findByText('tom@school.edu')).toBeInTheDocument();
    expect(screen.getByText('amy@school.edu')).toBeInTheDocument();
    expect(
      await screen.findByText('Added 2 emails from the CSV (1 duplicate skipped).')
    ).toBeInTheDocument();
  });

  it('reports when every CSV email is already in the list', async () => {
    const { container } = render(<Harness initial={['jane@school.edu']} />);

    uploadCsv(container, 'email\njane@school.edu');

    expect(
      await screen.findByText(
        'All 1 email from the CSV was already in the list.'
      )
    ).toBeInTheDocument();
  });

  it('reports a CSV without any email addresses', async () => {
    const { container } = render(<Harness />);

    uploadCsv(container, 'name,age\nJane,31');

    expect(
      await screen.findByText('No email addresses were found in that file.')
    ).toBeInTheDocument();
  });
});
