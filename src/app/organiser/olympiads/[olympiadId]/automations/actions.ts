'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { automationRules } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function createRule(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const portalId = formData.get('portalId') as string;
  const name = formData.get('name') as string;
  const triggerType = formData.get('triggerType') as any;
  const triggerOffsetMinutes = parseInt(formData.get('triggerOffsetMinutes') as string, 10);
  const templateSubject = formData.get('templateSubject') as string;
  const templateHtml = formData.get('templateHtml') as string;
  
  // For simplicity in this UI, we just support a "missingSubmissionsOnly" toggle 
  // as the condition. This can be expanded later.
  const missingSubmissionsOnly = formData.get('missingSubmissionsOnly') === 'true';
  const conditions = missingSubmissionsOnly ? { missingSubmissionsOnly: true } : null;

  await db.insert(automationRules).values({
    portalId,
    name,
    triggerType,
    triggerOffsetMinutes,
    conditions,
    templateSubject,
    templateHtml,
    isActive: true,
  });

  revalidatePath(`/organiser/olympiads/${portalId}/automations`);
}

export async function deleteRule(ruleId: string, portalId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  await db.delete(automationRules).where(
    and(eq(automationRules.id, ruleId), eq(automationRules.portalId, portalId))
  );

  revalidatePath(`/organiser/olympiads/${portalId}/automations`);
}

export async function toggleRuleState(ruleId: string, portalId: string, isActive: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  await db.update(automationRules)
    .set({ isActive })
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.portalId, portalId)));

  revalidatePath(`/organiser/olympiads/${portalId}/automations`);
}
