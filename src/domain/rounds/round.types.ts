import type { RoundState } from './round-state-machine';

// Shape shared by the scheduler, the notification engine and the UI when
// reasoning about a round. Mirrors the `rounds` table columns that matter for
// the round lifecycle and reminder emails.
export type Round = {
  id: string;
  portalId: string;
  portalName: string;
  name: string;
  orderIndex: number;
  deliveryMethod: 'online' | 'paper';
  opensAt: Date;
  closesAt: Date;
  qualifyingThreshold: string | null;
  resultsPublishedAt: Date | null;
};

export type { RoundState };
