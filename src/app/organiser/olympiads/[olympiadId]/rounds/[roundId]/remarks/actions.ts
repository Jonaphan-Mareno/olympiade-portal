'use server';

import { db } from '@/lib/db';
import { results, submissions, inAppNotifications, rounds } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function resolveRemark(resultId: string, outcome: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    // Get the result and submission to find the educator (or school) to notify
    const [resultRow] = await db
      .select({
        submissionId: results.submissionId,
      })
      .from(results)
      .where(eq(results.id, resultId))
      .limit(1);

    if (!resultRow) {
      throw new Error('Result not found');
    }

    const [submissionRow] = await db
      .select({
        studentMembershipId: submissions.studentMembershipId,
        roundId: submissions.roundId,
      })
      .from(submissions)
      .where(eq(submissions.id, resultRow.submissionId))
      .limit(1);

    await db
      .update(results)
      .set({
        status: 'remark_resolved',
        remarkOutcome: outcome,
      })
      .where(eq(results.id, resultId));

    if (submissionRow && submissionRow.roundId) {
      // Find the portalId to notify educators
      const [roundRow] = await db.select({ portalId: rounds.portalId, name: rounds.name }).from(rounds).where(eq(rounds.id, submissionRow.roundId)).limit(1);
      if (roundRow) {
        const { notifyEducatorsInPortal } = await import('@/domain/notifications/in-app-notifications');
        await notifyEducatorsInPortal(
          roundRow.portalId,
          'Remark Request Resolved',
          `A remark request for ${roundRow.name} has been resolved. Outcome: ${outcome}`,
          `/educator/results/${resultRow.submissionId}`
        );
      }
    }

    revalidatePath(`/organiser/olympiads/[olympiadId]/rounds/[roundId]/remarks`, 'page');
    return { success: true };
  } catch (error: any) {
    console.error('Error resolving remark:', error);
    return { success: false, error: error.message };
  }
}
