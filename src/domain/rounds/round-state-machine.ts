// scheduled -> open -> closed -> released
export type RoundState = 'scheduled' | 'open' | 'closed' | 'released';

/**
 * Derive a round's lifecycle state from its timestamps. State is not stored
 * per-row; it is a pure function of opensAt/closesAt/resultsPublishedAt
 * relative to `now`, so every part of the app (scheduler, dashboards, UI
 * badges) agrees on it without a state column drifting out of sync.
 *
 * - released takes precedence: once results are published the round stays
 *   released even though closesAt is in the past.
 */
export function deriveRoundState(
  round: {
    opensAt: Date;
    closesAt: Date;
    resultsPublishedAt: Date | null;
  },
  now: Date = new Date()
): RoundState {
  if (round.resultsPublishedAt) return 'released';
  if (now < round.opensAt) return 'scheduled';
  if (now < round.closesAt) return 'open';
  return 'closed';
}
