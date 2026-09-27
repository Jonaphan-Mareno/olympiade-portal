'use server';

import { db } from '@/lib/db';
import { results, submissions, memberships } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function requestStudentRemark(submissionId: string, reason: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    // Verify ownership
    const [sub] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .innerJoin(memberships, eq(submissions.studentMembershipId, memberships.id))
      .where(
        and(
          eq(submissions.id, submissionId),
          eq(memberships.userId, user.id)
        )
      )
      .limit(1);

    if (!sub) {
      return { success: false, error: 'Unauthorized to request remark for this submission' };
    }

    await db
      .update(results)
      .set({
        status: 'remark_requested',
        remarkReason: reason,
      })
      .where(eq(results.submissionId, submissionId));

    revalidatePath(`/results/scores/${submissionId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error requesting remark:', error);
    return { success: false, error: error.message };
  }
}
