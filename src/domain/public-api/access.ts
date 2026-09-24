import { deriveRoundState } from '@/domain/rounds/round-state-machine';

// Access gates for the public API (src/app/api/public/*). The public routes
// expose only data that is safe for anyone to read: a round's materials must
// not be readable while entrants are still sitting it, and marks must not be
// readable until the organiser has released the results.

/**
 * Question papers and questions become available once the round has closed
 * (state 'closed' or 'released'), so publishing them cannot leak the paper
 * to entrants who are still writing.
 */
export function isSemiPublicAvailable(
  round: { opensAt: Date; closesAt: Date; resultsPublishedAt: Date | null },
  now: Date = new Date()
): boolean {
  const state = deriveRoundState(round, now);
  return state === 'closed' || state === 'released';
}

/**
 * Public leaderboards only show marks for rounds whose results the organiser
 * has explicitly published (results_published_at set on release).
 */
export function areResultsPublished(round: {
  resultsPublishedAt: Date | null;
}): boolean {
  return round.resultsPublishedAt !== null;
}
