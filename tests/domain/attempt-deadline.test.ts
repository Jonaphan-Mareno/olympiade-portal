import { describe, it, expect } from 'vitest';
import { computeAttemptDeadline } from '@/domain/rounds/attempt-deadline';

const MIN = 60_000;

describe('computeAttemptDeadline', () => {
  it('returns start + duration when that lands before the round close', () => {
    const startedAt = new Date('2026-10-01T09:00:00Z');
    const closesAt = new Date('2026-10-03T09:00:00Z'); // 2 days later

    // A 90-minute limit from start is well inside the window.
    expect(computeAttemptDeadline(startedAt, 90, closesAt)).toBe(
      startedAt.getTime() + 90 * MIN
    );
  });

  it('caps at the round close when start + duration would overrun it', () => {
    const startedAt = new Date('2026-10-03T08:00:00Z');
    const closesAt = new Date('2026-10-03T09:00:00Z'); // 1 hour after start

    // A 2880-minute (2-day) limit must not extend past closesAt.
    expect(computeAttemptDeadline(startedAt, 2880, closesAt)).toBe(closesAt.getTime());
  });

  it('returns the same instant when start + duration equals the close exactly', () => {
    const startedAt = new Date('2026-10-01T09:00:00Z');
    const closesAt = new Date('2026-10-03T09:00:00Z');
    const windowMinutes = (closesAt.getTime() - startedAt.getTime()) / MIN; // 2880

    expect(computeAttemptDeadline(startedAt, windowMinutes, closesAt)).toBe(
      closesAt.getTime()
    );
  });

  it('caps a late starter at closesAt when the duration is the full derived window', () => {
    // Mirrors production: durationMinutes == the whole open->close window and the
    // student starts 5h after open. The deadline must be closesAt, NOT closesAt + 5h.
    const opensAt = new Date('2026-10-01T09:00:00Z');
    const closesAt = new Date('2026-10-03T09:00:00Z');
    const windowMinutes = (closesAt.getTime() - opensAt.getTime()) / MIN;
    const startedAt = new Date(opensAt.getTime() + 5 * 60 * MIN); // 5h late

    expect(computeAttemptDeadline(startedAt, windowMinutes, closesAt)).toBe(
      closesAt.getTime()
    );
  });
});
