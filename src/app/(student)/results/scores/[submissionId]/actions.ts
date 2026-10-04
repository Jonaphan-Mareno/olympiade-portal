'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { createRemarkRequest } from '@/domain/remarks/remarks';

export async function requestStudentRemark(submissionId: string, reason: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const result = await createRemarkRequest(user.id, submissionId, reason);
    if (result.error) return { success: false, error: result.error };

    revalidatePath(`/results/scores/${submissionId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error requesting remark:', error);
    return { success: false, error: 'Could not submit your request. Please try again.' };
  }
}
