import { describe, it, expect, afterEach } from 'vitest';
import { formatSAST, parseSASTInput, toSASTInputValue } from '@/lib/sast';

const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
});

// The server's own time zone must never change what the organiser sees or
// when a round opens (Vercel runs in UTC, local dev often in SAST).
describe.each(['UTC', 'Africa/Johannesburg', 'America/New_York'])(
  'SAST round times with the server in %s',
  (tz) => {
    it('parses an organiser-entered time as SAST', () => {
      process.env.TZ = tz;
      // 16:45 SAST is 14:45 UTC
      expect(parseSASTInput('2026-09-24T16:45')?.toISOString()).toBe(
        '2026-09-24T14:45:00.000Z'
      );
    });

    it('shows the stored time back unchanged, so saving never shifts it', () => {
      process.env.TZ = tz;
      const stored = parseSASTInput('2026-09-24T16:45')!;
      expect(toSASTInputValue(stored)).toBe('2026-09-24T16:45');
      // A second save round-trips to the same instant
      expect(parseSASTInput(toSASTInputValue(stored))).toEqual(stored);
    });

    it('displays the time in SAST', () => {
      process.env.TZ = tz;
      expect(formatSAST(new Date('2026-09-24T14:45:00Z'))).toContain('16:45 SAST');
    });
  }
);

describe('parseSASTInput', () => {
  it('rejects empty or malformed values', () => {
    expect(parseSASTInput('')).toBeNull();
    expect(parseSASTInput(null)).toBeNull();
    expect(parseSASTInput('24/09/2026 16:45')).toBeNull();
  });

  it('crosses midnight correctly', () => {
    expect(parseSASTInput('2026-09-25T01:00')?.toISOString()).toBe('2026-09-24T23:00:00.000Z');
    expect(toSASTInputValue(new Date('2026-09-24T23:00:00Z'))).toBe('2026-09-25T01:00');
  });
});
