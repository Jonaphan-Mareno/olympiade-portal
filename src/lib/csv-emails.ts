// Batch-invite helpers for the email-list invite forms (organiser -> educator
// and educator -> student): extract email addresses out of an uploaded CSV
// entirely in the browser. The file itself is never uploaded or persisted
// anywhere — only the addresses are merged into the form's email list and
// submitted through the normal invite flows.

// Deliberately permissive: any token shaped like an address is collected, so
// files exported from Excel/Sheets work whether they are single-column,
// multi-column (Name,Email,Role), quoted, or semicolon-delimited. Anything
// without an "@" (headers, names, roles) is ignored by the pattern.
const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Returns the unique, lower-cased email addresses found in raw CSV text,
 * in first-seen order. Returns an empty array when the file contains none.
 */
export function extractEmailsFromCsv(csvText: string): string[] {
  const seen = new Set<string>();
  for (const match of csvText.matchAll(EMAIL_PATTERN)) {
    seen.add(match[0].toLowerCase());
  }
  return [...seen];
}

export type CsvMergeNote = { tone: 'success' | 'error'; text: string };

/**
 * Merges the addresses found in `csvText` into `existing`, skipping ones
 * already present, and builds the status line shown under the field.
 * Shared by every CSV-capable invite form so their behaviour and wording
 * stay identical.
 */
export function mergeCsvEmails(
  existing: string[],
  csvText: string
): { emails: string[]; note: CsvMergeNote } {
  const found = extractEmailsFromCsv(csvText);

  if (found.length === 0) {
    return {
      emails: existing,
      note: { tone: 'error', text: 'No email addresses were found in that file.' },
    };
  }

  const fresh = found.filter((email) => !existing.includes(email));
  const duplicates = found.length - fresh.length;

  if (fresh.length === 0) {
    return {
      emails: existing,
      note: {
        tone: 'success',
        text: `All ${found.length} email${found.length === 1 ? '' : 's'} from the CSV ${found.length === 1 ? 'was' : 'were'} already in the list.`,
      },
    };
  }

  const added = `Added ${fresh.length} email${fresh.length === 1 ? '' : 's'} from the CSV`;
  return {
    emails: [...existing, ...fresh],
    note: {
      tone: 'success',
      text:
        duplicates > 0
          ? `${added} (${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped).`
          : `${added}.`,
    },
  };
}
