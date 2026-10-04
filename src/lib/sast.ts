// The portal schedules everything in South African Standard Time (UTC+2, no
// daylight saving). Round times are stored as absolute instants; these
// helpers convert them to and from SAST wall-clock time *independently of
// the server's own time zone* — on Vercel the server runs in UTC, so using
// local-time APIs there would shift every round by two hours.

export const SAST_TIME_ZONE = 'Africa/Johannesburg';
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** A Date as a `datetime-local` input value in SAST, e.g. "2026-09-24T16:45". */
export function toSASTInputValue(date: Date | null | undefined): string {
  if (!date) return '';
  return new Date(date.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * Parses a `datetime-local` value entered in SAST. Returns null for empty or
 * malformed input so callers can reject it explicitly.
 */
export function parseSASTInput(value: string | null | undefined): Date | null {
  const trimmed = value?.trim() ?? '';
  if (!INPUT_PATTERN.test(trimmed)) return null;
  const date = new Date(`${trimmed}+02:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Human-readable SAST date and time, e.g. "24 Sept 2026, 16:45 SAST". */
export function formatSAST(
  date: Date | string,
  style: { dateStyle?: 'short' | 'medium' | 'long'; timeStyle?: 'short' } = {
    dateStyle: 'medium',
    timeStyle: 'short',
  }
): string {
  return (
    new Intl.DateTimeFormat('en-GB', { timeZone: SAST_TIME_ZONE, ...style }).format(
      new Date(date)
    ) + (style.timeStyle ? ' SAST' : '')
  );
}
