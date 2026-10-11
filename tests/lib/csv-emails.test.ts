import { describe, it, expect } from 'vitest';
import { extractEmailsFromCsv } from '@/lib/csv-emails';

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
