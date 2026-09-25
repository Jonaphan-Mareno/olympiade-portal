'use server';

import { db } from '@/lib/db';
import { results } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function requestRemark(submissionId: string, reason: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await db
      .update(results)
      .set({
        status: 'remark_requested',
        remarkReason: reason,
      })
      .where(eq(results.submissionId, submissionId));

    revalidatePath(`/educator/results/${submissionId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error requesting remark:', error);
    return { success: false, error: error.message };
  }
}
