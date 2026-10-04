'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { automationRules, portals } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { RECOMMENDED_RULES } from '@/domain/notifications/automation-rules';
import { draftConditions, draftToOffsetMinutes, validateDraft } from './rule-input';

/** Only the olympiad's owner may configure its automations. */
async function assertPortalOwner(portalId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const [portal] = await db
    .select({ ownerUserId: portals.ownerUserId })
    .from(portals)
    .where(eq(portals.id, portalId));
  if (!portal || portal.ownerUserId !== user.id) {
    throw new Error('Not authorized to manage automations for this olympiad');
  }
}

function revalidate(portalId: string) {
  revalidatePath(`/organiser/olympiads/${portalId}/automations`);
}

/** Creates a rule, or updates `ruleId` when given. */
export async function saveRule(
  portalId: string,
  rawDraft: unknown,
  ruleId?: string
): Promise<{ error?: string }> {
  await assertPortalOwner(portalId);

  const parsed = validateDraft(rawDraft);
  if ('error' in parsed) return { error: parsed.error };
  const { draft } = parsed;

  const values = {
    name: draft.name,
    triggerType: draft.triggerType,
    triggerOffsetMinutes: draftToOffsetMinutes(draft),
    conditions: draftConditions(draft),
    // The general template supplies the body; these hold the optional
    // subject override and the organiser's plain-text note
    templateSubject: draft.subject,
    templateHtml: draft.note,
    isActive: draft.isActive,
  };

  if (ruleId) {
    await db
      .update(automationRules)
      .set(values)
      .where(
        and(eq(automationRules.id, ruleId), eq(automationRules.portalId, portalId))
      );
  } else {
    await db.insert(automationRules).values({ portalId, ...values });
  }

  revalidate(portalId);
  return {};
}

export async function addRecommendedRules(portalId: string): Promise<void> {
  await assertPortalOwner(portalId);

  await db.insert(automationRules).values(
    RECOMMENDED_RULES.map((rule) => ({
      portalId,
      name: rule.name,
      triggerType: rule.triggerType,
      triggerOffsetMinutes: rule.triggerOffsetMinutes,
      conditions: rule.conditions,
      templateSubject: '',
      templateHtml: '',
      isActive: true,
    }))
  );

  revalidate(portalId);
}

export async function deleteRule(ruleId: string, portalId: string) {
  await assertPortalOwner(portalId);

  await db
    .delete(automationRules)
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.portalId, portalId)));

  revalidate(portalId);
}

export async function toggleRuleState(
  ruleId: string,
  portalId: string,
  isActive: boolean
) {
  await assertPortalOwner(portalId);

  await db
    .update(automationRules)
    .set({ isActive })
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.portalId, portalId)));

  revalidate(portalId);
}
