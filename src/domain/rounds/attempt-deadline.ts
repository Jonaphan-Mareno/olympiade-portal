/**
 * The instant an online attempt must stop, as epoch milliseconds.
 *
 * A student's countdown normally runs `durationMinutes` from the moment they
 * open the test (`startedAt`). It can never extend past the round's `closesAt`,
 * though — otherwise a student who starts late would gain extra time beyond the
 * published window (with the duration now derived from that window, the overrun
 * would equal exactly how late they started). The deadline is therefore the
 * earlier of "start + duration" and "round close".
 *
 * Pure and dependency-free so it can be shared by the server (save route,
 * sitting page) and the client (ExamInterface) without divergence.
 */
export function computeAttemptDeadline(
  startedAt: Date,
  durationMinutes: number,
  closesAt: Date
): number {
  const relativeEnd = startedAt.getTime() + durationMinutes * 60_000;
  return Math.min(relativeEnd, closesAt.getTime());
}
