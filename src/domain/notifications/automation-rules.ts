// Organiser-configured automation rules. A rule says *which* chasing email
// the portal sends, *when* (an offset from a round milestone), under *which
// conditions*, and *what follows* (who receives it, plus an optional note
// appended to the portal's general email template). The scheduler sweep
// (src/domain/rounds/round-scheduler.ts) evaluates every active rule against
// every round each hour; the organiser can dry-run any rule against a round
// before it acts on one.

import { db } from '@/lib/db';
import { automationRules } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { deriveRoundState } from '../rounds/round-state-machine';
import type { Round } from '../rounds/round.types';
import {
  dispatchPlanned,
  planResultsPublishedNotifications,
  planRoundClosingReminders,
  planRoundOpeningReminders,
  planSubmissionOverdueFollowups,
  type DispatchSummary,
  type PlannedEmail,
  type SendOptions,
} from './automation-engine';
import {
  isAutomationTrigger,
  parseConditions,
  type AutomationTrigger,
  type RuleConditions,
} from './automation-triggers';

export * from './automation-triggers';

export type AutomationRuleConfig = {
  // null for an unsaved rule being previewed from the form
  id: string | null;
  portalId: string;
  name: string;
  triggerType: AutomationTrigger;
  // Negative = before the milestone, positive = after
  triggerOffsetMinutes: number;
  conditions: RuleConditions;
  // Optional subject override (blank = the template's default subject)
  subject: string;
  // Optional plain-text note appended to the general template
  note: string;
  isActive: boolean;
};

type AutomationRuleRow = typeof automationRules.$inferSelect;

export function toRuleConfig(row: AutomationRuleRow): AutomationRuleConfig | null {
  if (!isAutomationTrigger(row.triggerType)) return null;
  return {
    id: row.id,
    portalId: row.portalId,
    name: row.name,
    triggerType: row.triggerType,
    triggerOffsetMinutes: row.triggerOffsetMinutes,
    conditions: parseConditions(row.conditions),
    subject: row.templateSubject,
    note: row.templateHtml,
    isActive: row.isActive,
  };
}

/** Active rules for the given portals, grouped by portal id. */
export async function loadActiveRules(
  portalIds: string[]
): Promise<Map<string, AutomationRuleConfig[]>> {
  const byPortal = new Map<string, AutomationRuleConfig[]>();
  const unique = [...new Set(portalIds)];
  if (unique.length === 0) return byPortal;

  const rows = await db
    .select()
    .from(automationRules)
    .where(
      and(
        inArray(automationRules.portalId, unique),
        eq(automationRules.isActive, true)
      )
    );

  for (const row of rows) {
    const rule = toRuleConfig(row);
    if (!rule) continue;
    const list = byPortal.get(rule.portalId) ?? [];
    list.push(rule);
    byPortal.set(rule.portalId, list);
  }
  return byPortal;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// How long after its fire time a rule may still act. Lets the hourly sweep
// retry failed sends and pick up rules created shortly after their moment,
// without a brand-new rule emailing every school about long-past rounds.
export const RULE_CATCHUP_MS = 7 * DAY_MS;

export type RuleTiming =
  | { status: 'not_applicable'; fireAt: Date | null; reason: string }
  | { status: 'waiting'; fireAt: Date; reason: string }
  | { status: 'due'; fireAt: Date; reason: string }
  | { status: 'missed'; fireAt: Date; reason: string };

function milestoneDate(trigger: AutomationTrigger, round: Round): Date | null {
  switch (trigger) {
    case 'round_opening':
      return round.opensAt;
    case 'round_closing':
    case 'submission_overdue':
      return round.closesAt;
    case 'results_published':
      return round.resultsPublishedAt;
  }
}

/**
 * Whether a rule should act on a round right now. Pure, so the sweep, the
 * publish action and the organiser's dry run all agree on it.
 */
export function evaluateRuleTiming(
  rule: Pick<AutomationRuleConfig, 'triggerType' | 'triggerOffsetMinutes' | 'conditions'>,
  round: Round,
  now: Date = new Date()
): RuleTiming {
  if (
    rule.conditions.roundIds &&
    !rule.conditions.roundIds.includes(round.id)
  ) {
    return {
      status: 'not_applicable',
      fireAt: null,
      reason: 'This rule is limited to other rounds.',
    };
  }

  const milestone = milestoneDate(rule.triggerType, round);
  if (!milestone) {
    return {
      status: 'not_applicable',
      fireAt: null,
      reason: 'Results for this round have not been published yet.',
    };
  }

  const fireAt = new Date(
    milestone.getTime() + rule.triggerOffsetMinutes * MINUTE_MS
  );
  if (now < fireAt) {
    return { status: 'waiting', fireAt, reason: 'Scheduled to send later.' };
  }

  const state = deriveRoundState(round, now);
  if (rule.triggerType === 'round_opening' && state !== 'scheduled' && state !== 'open') {
    return { status: 'missed', fireAt, reason: 'The round has already closed.' };
  }
  if (rule.triggerType === 'round_closing' && state !== 'open') {
    return {
      status: 'missed',
      fireAt,
      reason:
        state === 'scheduled'
          ? 'The round has not opened yet.'
          : 'The round has already closed.',
    };
  }
  if (rule.triggerType === 'submission_overdue' && state === 'released') {
    return {
      status: 'missed',
      fireAt,
      reason: 'Results are already out, so submissions are no longer chased.',
    };
  }
  if (now.getTime() - fireAt.getTime() > RULE_CATCHUP_MS) {
    return {
      status: 'missed',
      fireAt,
      reason: 'Its send time passed more than 7 days ago.',
    };
  }

  return { status: 'due', fireAt, reason: 'Due now — the next sweep sends it.' };
}

function sendOptions(rule: AutomationRuleConfig): SendOptions {
  return {
    ruleId: rule.id,
    note: rule.note,
    subjectTemplate: rule.subject,
    missingSubmissionsOnly: rule.conditions.missingSubmissionsOnly,
    includeEntrants: rule.conditions.includeEntrants,
  };
}

/** The emails a rule would send for a round right now (no side effects). */
export async function planRuleEmails(
  rule: AutomationRuleConfig,
  round: Round,
  now: Date = new Date()
): Promise<PlannedEmail[]> {
  const opts = sendOptions(rule);
  switch (rule.triggerType) {
    case 'round_opening':
      return planRoundOpeningReminders(round, opts);
    case 'round_closing':
      return planRoundClosingReminders(round, now, opts);
    case 'submission_overdue':
      return planSubmissionOverdueFollowups(round, opts);
    case 'results_published':
      return planResultsPublishedNotifications(round, opts);
  }
}

export type RuleRunOutcome = {
  triggered: string[];
  summary: DispatchSummary;
};

/**
 * Runs every rule that is due for the round. Errors in one rule never stop
 * the others.
 */
export async function runDueRules(
  rules: AutomationRuleConfig[],
  round: Round,
  now: Date = new Date()
): Promise<RuleRunOutcome> {
  const outcome: RuleRunOutcome = {
    triggered: [],
    summary: { sent: 0, skipped: 0, failed: 0 },
  };

  for (const rule of rules) {
    if (!rule.id || !rule.isActive) continue;
    if (evaluateRuleTiming(rule, round, now).status !== 'due') continue;

    outcome.triggered.push(rule.name);
    try {
      const planned = await planRuleEmails(rule, round, now);
      const summary = await dispatchPlanned(planned, rule.id);
      outcome.summary.sent += summary.sent;
      outcome.summary.skipped += summary.skipped;
      outcome.summary.failed += summary.failed;
    } catch (err) {
      console.error(
        `Automation rule "${rule.name}" failed for round ${round.name}:`,
        err
      );
      outcome.summary.failed++;
    }
  }

  return outcome;
}

/**
 * The rule set a new olympiad starts from: it mirrors the reminders the
 * portal used to send automatically, and the organiser can edit, pause or
 * delete any of them.
 */
export const RECOMMENDED_RULES: Array<
  Pick<
    AutomationRuleConfig,
    'name' | 'triggerType' | 'triggerOffsetMinutes' | 'conditions'
  >
> = [
  {
    name: 'Round opens in 7 days',
    triggerType: 'round_opening',
    triggerOffsetMinutes: -7 * 24 * 60,
    conditions: { roundIds: null, missingSubmissionsOnly: false, includeEntrants: true },
  },
  {
    name: 'Round closes in 3 days',
    triggerType: 'round_closing',
    triggerOffsetMinutes: -3 * 24 * 60,
    conditions: { roundIds: null, missingSubmissionsOnly: false, includeEntrants: true },
  },
  {
    name: 'Final hour — schools still missing submissions',
    triggerType: 'round_closing',
    triggerOffsetMinutes: -60,
    conditions: { roundIds: null, missingSubmissionsOnly: true, includeEntrants: true },
  },
  {
    name: 'Submissions still missing 2 days after close',
    triggerType: 'submission_overdue',
    triggerOffsetMinutes: 2 * 24 * 60,
    conditions: { roundIds: null, missingSubmissionsOnly: false, includeEntrants: true },
  },
  {
    name: 'Results are out',
    triggerType: 'results_published',
    triggerOffsetMinutes: 0,
    conditions: { roundIds: null, missingSubmissionsOnly: false, includeEntrants: true },
  },
];
