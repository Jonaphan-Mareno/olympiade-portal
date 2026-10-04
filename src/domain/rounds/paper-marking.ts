// Marking window for physical (paper) scripts. Schools enter their entrants'
// marks from when the round opens until the organiser's marking deadline;
// rounds without one keep the original default of 24 hours after closing.

export const DEFAULT_MARKING_WINDOW_MS = 24 * 60 * 60 * 1000;

export type MarkingWindowRound = {
  opensAt: Date;
  closesAt: Date;
  markingClosesAt: Date | null;
  resultsPublishedAt: Date | null;
};

export function getMarkingDeadline(round: MarkingWindowRound): Date {
  return (
    round.markingClosesAt ??
    new Date(round.closesAt.getTime() + DEFAULT_MARKING_WINDOW_MS)
  );
}

export type MarkingWindowStatus =
  | { status: 'not_open'; reason: string }
  | { status: 'open'; deadline: Date }
  | { status: 'closed'; reason: string };

/**
 * Whether physical marks can be entered now. Once results are published the
 * marks are final — changes go through a remark instead.
 */
export function getMarkingWindowStatus(
  round: MarkingWindowRound,
  now: Date = new Date()
): MarkingWindowStatus {
  if (round.resultsPublishedAt) {
    return {
      status: 'closed',
      reason: 'Results have been published. Changes now go through a remark request.',
    };
  }
  if (now < round.opensAt) {
    return { status: 'not_open', reason: 'Marking opens when the round opens.' };
  }
  const deadline = getMarkingDeadline(round);
  if (now > deadline) {
    return { status: 'closed', reason: 'The marking deadline for this round has passed.' };
  }
  return { status: 'open', deadline };
}
