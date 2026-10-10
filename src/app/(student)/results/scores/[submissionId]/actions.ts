'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { createRemarkRequest, withdrawRemarkRequest } from '@/domain/remarks/remarks';
import type { ScriptPin } from '@/domain/scripts/script-rules';

/** `paperQuery` is only sent for paper scripts; online appeals send a reason. */
export async function requestStudentRemark(
  submissionId: string,
  reason: string,
  paperQuery?: { questionRefs: string; pins: ScriptPin[] }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const result = await createRemarkRequest(user.id, submissionId, reason, paperQuery ?? {});
    if (result.error) return { success: false, error: result.error };

    revalidatePath(`/results/scores/${submissionId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error requesting remark:', error);
    return { success: false, error: 'Could not submit your request. Please try again.' };
  }
}

/** Withdraw a pending appeal (it still counts as an attempt). */
export async function withdrawStudentRemark(submissionId: string, requestId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const result = await withdrawRemarkRequest(user.id, requestId);
    if (result.error) return { success: false, error: result.error };

    revalidatePath(`/results/scores/${submissionId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error withdrawing remark:', error);
    return { success: false, error: 'Could not withdraw your request. Please try again.' };
  }
}
