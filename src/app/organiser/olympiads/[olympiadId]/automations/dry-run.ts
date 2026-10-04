'use server';

// "Try against a round": runs a rule's real timing check and recipient
// selection against one round and renders the emails it would send — without
// sending anything or writing to notification_log. Works for saved rules and
// for unsaved drafts straight from the form.

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { automationRules, portals, rounds } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  describeOffset,
  evaluateRuleTiming,
  planRuleEmails,
  toRuleConfig,
  TRIGGER_INFO,
  type AutomationRuleConfig,
  type RuleTiming,
} from '@/domain/notifications/automation-rules';
import { getAlreadySentRecipients } from '@/domain/notifications/automation-engine';
import type { Round } from '@/domain/rounds/round.types';
import { draftConditions, draftToOffsetMinutes, validateDraft } from './rule-input';

export type SimulationRecipient = {
  email: string;
  schoolName: string | null;
  audience: 'school' | 'entrant';
  alreadySent: boolean;
};

export type SimulationResult =
  | { error: string }
  | {
      ruleName: string;
      roundName: string;
      triggerLabel: string;
      schedule: string;
      timing: {
        status: RuleTiming['status'];
        fireAt: string | null;
        reason: string;
      };
      recipients: SimulationRecipient[];
      sample: { to: string; subject: string; html: string } | null;
    };

async function loadOwnedRound(
  portalId: string,
  roundId: string
): Promise<Round | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const [row] = await db
    .select({
      id: rounds.id,
      portalId: rounds.portalId,
      portalName: portals.name,
      ownerUserId: portals.ownerUserId,
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
    .where(and(eq(rounds.id, roundId), eq(rounds.portalId, portalId)));

  if (!row) return { error: 'Round not found' };
  if (row.ownerUserId !== user.id) return { error: 'Unauthorized' };

  const { ownerUserId: _owner, ...round } = row;
  return round;
}

async function simulate(
  rule: AutomationRuleConfig,
  round: Round
): Promise<SimulationResult> {
  const now = new Date();
  const timing = evaluateRuleTiming(rule, round, now);

  try {
    const planned = await planRuleEmails(rule, round, now);
    const alreadySent = rule.id
      ? await getAlreadySentRecipients(round.id, rule.id)
      : new Set<string>();

    const recipients = planned.map((email) => ({
      email: email.recipientEmail,
      schoolName: email.schoolName,
      audience: email.audience,
      alreadySent: alreadySent.has(email.recipientMembershipId),
    }));
    // Preview a school email first — that is what the organiser configured
    const sampleEmail =
      planned.find((e) => e.audience === 'school') ?? planned[0] ?? null;

    return {
      ruleName: rule.name,
      roundName: round.name,
      triggerLabel: TRIGGER_INFO[rule.triggerType].label,
      schedule: describeOffset(rule.triggerOffsetMinutes, rule.triggerType),
      timing: {
        status: timing.status,
        fireAt: timing.fireAt ? timing.fireAt.toISOString() : null,
        reason: timing.reason,
      },
      recipients,
      sample: sampleEmail
        ? {
            to: sampleEmail.recipientEmail,
            subject: sampleEmail.subject,
            html: sampleEmail.html,
          }
        : null,
    };
  } catch (err: any) {
    console.error('Automation dry run failed:', err);
    return { error: err?.message ?? 'Simulation failed' };
  }
}

export async function simulateSavedRule(
  portalId: string,
  ruleId: string,
  roundId: string
): Promise<SimulationResult> {
  const round = await loadOwnedRound(portalId, roundId);
  if ('error' in round) return round;

  const [row] = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.portalId, portalId)));
  const rule = row ? toRuleConfig(row) : null;
  if (!rule) return { error: 'Rule not found' };

  return simulate(rule, round);
}

export async function simulateDraftRule(
  portalId: string,
  rawDraft: unknown,
  roundId: string
): Promise<SimulationResult> {
  const round = await loadOwnedRound(portalId, roundId);
  if ('error' in round) return round;

  const parsed = validateDraft(rawDraft);
  if ('error' in parsed) return { error: parsed.error };
  const { draft } = parsed;

  return simulate(
    {
      id: null,
      portalId,
      name: draft.name,
      triggerType: draft.triggerType,
      triggerOffsetMinutes: draftToOffsetMinutes(draft),
      conditions: draftConditions(draft),
      subject: draft.subject,
      note: draft.note,
      isActive: draft.isActive,
    },
    round
  );
}
