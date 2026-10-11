import { describe, it, expect } from 'vitest';
import { extractEmailsFromCsv, mergeCsvEmails } from '@/lib/csv-emails';

describe('mergeCsvEmails', () => {
  it('appends only fresh addresses and reports duplicates', () => {
    const r = mergeCsvEmails(['a@x.com'], 'a@x.com,b@x.com,c@x.com');
    expect(r.emails).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    expect(r.note).toEqual({
      tone: 'success',
      text: 'Added 2 emails from the CSV (1 duplicate skipped).',
    });
  });

  it('returns the same list unchanged when every address is already present', () => {
    const existing = ['a@x.com'];
    const r = mergeCsvEmails(existing, 'A@X.com');
    expect(r.emails).toBe(existing);
    expect(r.note.text).toBe('All 1 email from the CSV was already in the list.');
  });

  it('reports an error when the CSV has no addresses', () => {
    const existing: string[] = [];
    const r = mergeCsvEmails(existing, 'name,age\nJane,31');
    expect(r.emails).toBe(existing);
    expect(r.note).toEqual({
      tone: 'error',
      text: 'No email addresses were found in that file.',
    });
  });
});

// The parser powers the batch-invite CSV upload. It runs entirely in the
// browser — these tests pin the tolerated CSV shapes (headers, extra
// columns, quotes, delimiters) and the normalisation rules.

describe('extractEmailsFromCsv', () => {
  it('extracts a single-column list with a header row', () => {
    expect(
      extractEmailsFromCsv('email\nteacher@school.edu\nother@school.za')
    ).toEqual(['teacher@school.edu', 'other@school.za']);
  });

  it('finds the email column in a multi-column file', () => {
    expect(
      extractEmailsFromCsv(
        'Name,Email,Role\nJane Doe,jane@school.edu,Teacher\nTom,john@school.edu,Head'
      )
    ).toEqual(['jane@school.edu', 'john@school.edu']);
  });

  it('handles quoted fields, semicolons and angle brackets', () => {
    expect(
      extractEmailsFromCsv(
        '"Jane Doe";"jane@school.edu";"Teacher"\nJane <other@school.org>'
      )
    ).toEqual(['jane@school.edu', 'other@school.org']);
  });

  it('lower-cases and de-duplicates addresses', () => {
    expect(
      extractEmailsFromCsv('A@School.edu\na@school.edu\nA@SCHOOL.EDU')
    ).toEqual(['a@school.edu']);
  });

  it('ignores rows and headers without an email address', () => {
    expect(extractEmailsFromCsv('name,age\nJane,31\nTom,42')).toEqual([]);
    expect(extractEmailsFromCsv('')).toEqual([]);
  });

  it('does not treat bare words after an @ as addresses', () => {
    expect(extractEmailsFromCsv('handle @school, follow @team')).toEqual([]);
  });
});
