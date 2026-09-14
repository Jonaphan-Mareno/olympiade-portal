// The scheduler sweep: a single idempotent pass over every round of every
// approved portal that transitions rounds between lifecycle states (on paper,
// via deriveRoundState) and fires the matching reminder emails. It is invoked
// by the /api/webhooks/round-scheduler route (Vercel Cron, hourly — see
// vercel.json) and can also be triggered manually. Because every email the
// automation engine sends is deduplicated per (kind, round, recipient) in
// notification_log, running the sweep repeatedly is safe — it never
// double-sends.

import { db } from '@/lib/db';
import { portals, rounds } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { deriveRoundState } from './round-state-machine';
import type { Round, RoundState } from './round.types';
import {
  sendResultsPublishedNotifications,
  sendRoundClosingReminders,
  sendRoundOpeningReminders,
  sendSubmissionOverdueFollowups,
  type DispatchSummary,
} from '../notifications/automation-engine';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type ReminderConfig = {
  // Days before opensAt that the "round is opening" email goes out
  openingWindowDays: number;
  // Extra hours on top of openingWindowDays — lets a reminder fire, say,
  // 1 hour before a round opens without waiting for a whole day boundary
  openingWindowHours: number;
  // Days before closesAt that the "round is closing" email goes out
  closingWindowDays: number;
  // Extra hours on top of closingWindowDays — the final "closes in an hour"
  // nudge. A config of days=0, hours=1 sends the closing reminder exactly
  // within the last hour before closesAt.
  closingWindowHours: number;
  // Days after closesAt that the overdue follow-up is sent
  overdueAfterDays: number;
  // How long after publication the sweep keeps retrying failed
  // "results are out" sends (the dedupe log caps it at one per recipient)
  resultsCatchupDays: number;
};

export function getReminderConfig(): ReminderConfig {
  return {
    openingWindowDays: envInt('REMINDER_OPENING_WINDOW_DAYS', 7),
    openingWindowHours: envInt('REMINDER_OPENING_WINDOW_HOURS', 0),
    closingWindowDays: envInt('REMINDER_CLOSING_WINDOW_DAYS', 3),
    closingWindowHours: envInt('REMINDER_CLOSING_WINDOW_HOURS', 0),
    overdueAfterDays: envInt('REMINDER_OVERDUE_AFTER_DAYS', 2),
    resultsCatchupDays: envInt('REMINDER_RESULTS_CATCHUP_DAYS', 14),
  };
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export type SweepRoundOutcome = {
  roundId: string;
  roundName: string;
  state: RoundState;
  // Names of the reminder kinds the sweep attempted for this round
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
  const config = getReminderConfig();

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

  const outcomes: SweepRoundOutcome[] = [];

  for (const row of rows) {
    const round: Round = { ...row };
    const state = deriveRoundState(round, now);
    const outcome: SweepRoundOutcome = {
      roundId: round.id,
      roundName: round.name,
      state,
      triggered: [],
      summary: { sent: 0, skipped: 0, failed: 0 },
    };

    const run = async (kind: string, fn: () => Promise<DispatchSummary>) => {
      outcome.triggered.push(kind);
      const summary = await fn();
      outcome.summary.sent += summary.sent;
      outcome.summary.skipped += summary.skipped;
      outcome.summary.failed += summary.failed;
    };

    try {
      // Windows are compared in exact milliseconds (days plus optional
      // hours) rather than rounded whole days, so an hours-only window such
      // as "1 hour before close" is honoured precisely.
      if (state === 'scheduled') {
        const msUntilOpen = round.opensAt.getTime() - now.getTime();
        const windowMs =
          config.openingWindowDays * DAY_MS +
          config.openingWindowHours * HOUR_MS;
        if (msUntilOpen <= windowMs) {
          await run('round_opening_reminder', () =>
            sendRoundOpeningReminders(round)
          );
        }
      } else if (state === 'open') {
        const msUntilClose = round.closesAt.getTime() - now.getTime();
        const windowMs =
          config.closingWindowDays * DAY_MS +
          config.closingWindowHours * HOUR_MS;
        if (msUntilClose <= windowMs) {
          await run('round_closing_reminder', () =>
            sendRoundClosingReminders(round, now)
          );
        }
      } else if (state === 'closed') {
        const msSinceClose = now.getTime() - round.closesAt.getTime();
        if (msSinceClose >= config.overdueAfterDays * DAY_MS) {
          await run('submission_overdue_followup', () =>
            sendSubmissionOverdueFollowups(round)
          );
        }
      } else if (state === 'released') {
        // Primary trigger is the organiser's publish action, which sends
        // immediately; the sweep also catches up (failed sends, or rounds
        // released without the direct send ever running) for a bounded
        // window after publication.
        const msSincePublished = round.resultsPublishedAt
          ? now.getTime() - round.resultsPublishedAt.getTime()
          : Infinity;
        if (msSincePublished <= config.resultsCatchupDays * DAY_MS) {
          await run('results_published', () =>
            sendResultsPublishedNotifications(round)
          );
        }
      }
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
