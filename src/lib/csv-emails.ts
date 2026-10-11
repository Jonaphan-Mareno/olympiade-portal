// Batch-invite helper for the organiser forms: extracts educator email
// addresses out of an uploaded CSV entirely in the browser. The file itself
// is never uploaded or persisted anywhere — only the addresses are merged
// into the form's email list and submitted through the normal invite flows.

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
