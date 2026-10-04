// The scheduler sweep: a single idempotent pass over every round of every
// approved portal that evaluates the organiser's automation rules
// (src/domain/notifications/automation-rules.ts) and sends whichever are due.
// Which reminders exist, when they fire and who they reach is configured per
// olympiad on the Automations page — nothing here is hard-coded. It is
// invoked by the /api/webhooks/round-scheduler route (Vercel Cron, hourly —
// see vercel.json) and can also be triggered manually. Because every email
// is deduplicated per (kind, round, recipient, rule) in notification_log,
// running the sweep repeatedly is safe — it never double-sends.

import { db } from '@/lib/db';
import { portals, rounds } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { deriveRoundState } from './round-state-machine';
import type { Round, RoundState } from './round.types';
import type { DispatchSummary } from '../notifications/automation-engine';
import { loadActiveRules, runDueRules } from '../notifications/automation-rules';

export type SweepRoundOutcome = {
  roundId: string;
  roundName: string;
  state: RoundState;
  // Names of the automation rules the sweep ran for this round
  triggered: string[];
  summary: DispatchSummary;
};

export type SweepResult = {
  ranAt: string;
  portalCount: number;
  roundCount: number;
  outcomes: SweepRoundOutcome[];
};

/**
 * Runs one full pass. Errors for a single round never abort the sweep —
 * they are logged and reported in the outcome so one broken portal cannot
 * silence reminders for everyone else.
 */
export async function sweep(now: Date = new Date()): Promise<SweepResult> {
  const rows = await db
    .select({
      id: rounds.id,
      portalId: rounds.portalId,
      portalName: portals.name,
      name: rounds.name,
      orderIndex: rounds.orderIndex,
      deliveryMethod: rounds.deliveryMethod,
      opensAt: rounds.opensAt,
      closesAt: rounds.closesAt,
      qualifyingThreshold: rounds.qualifyingThreshold,
      resultsPublishedAt: rounds.resultsPublishedAt,
    })
    .from(rounds)
    .innerJoin(portals, eq(portals.id, rounds.portalId))
    .where(eq(portals.status, 'approved'));

  const rulesByPortal = await loadActiveRules(rows.map((r) => r.portalId));
  const outcomes: SweepRoundOutcome[] = [];

  for (const row of rows) {
    const round: Round = { ...row };
    const outcome: SweepRoundOutcome = {
      roundId: round.id,
      roundName: round.name,
      state: deriveRoundState(round, now),
      triggered: [],
      summary: { sent: 0, skipped: 0, failed: 0 },
    };

    try {
      const result = await runDueRules(
        rulesByPortal.get(round.portalId) ?? [],
        round,
        now
      );
      outcome.triggered = result.triggered;
      outcome.summary = result.summary;
    } catch (err) {
      console.error(`Scheduler error for round ${round.name}:`, err);
      outcome.summary.failed++;
    }

    outcomes.push(outcome);
  }

  return {
    ranAt: now.toISOString(),
    portalCount: new Set(rows.map((r) => r.portalId)).size,
    roundCount: rows.length,
    outcomes,
  };
}
