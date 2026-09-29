'use server';

import { db } from '@/lib/db';
import { submissions, results, memberships } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function submitBulkOfflineMarks(
  roundId: string, 
  marksData: { studentMembershipId: string, score: number }[]
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Not authenticated' };
  }

  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.role, 'educator')));

  if (educatorMemberships.length === 0) {
    return { error: 'Not authorized' };
  }
  
  // Use the first educator membership for the graded_by_membership_id
  const gradedByMembershipId = educatorMemberships[0].id;

  try {
    // We need to upsert submissions and results for these students
    for (const mark of marksData) {
      if (isNaN(mark.score)) continue;

      // check if an offline submission already exists
      const existingSubmissions = await db.select().from(submissions).where(
        and(
          eq(submissions.roundId, roundId),
          eq(submissions.studentMembershipId, mark.studentMembershipId)
        )
      );
      
      let submissionId: string;

      if (existingSubmissions.length > 0) {
        submissionId = existingSubmissions[0].id;
      } else {
        // Create an offline submission
        const newSubmissions = await db.insert(submissions).values({
          roundId,
          studentMembershipId: mark.studentMembershipId,
          submittedByMembershipId: gradedByMembershipId,
          submissionType: 'offline',
          status: 'submitted',
          submittedAt: new Date(),
        }).returning({ id: submissions.id });
        submissionId = newSubmissions[0].id;
      }

      // Upsert the result
      const existingResults = await db.select().from(results).where(eq(results.submissionId, submissionId));
      if (existingResults.length > 0) {
        await db.update(results).set({
          score: mark.score.toString(),
          gradedByMembershipId,
          status: 'auto_marked', // Set to auto_marked as it's the final score
        }).where(eq(results.id, existingResults[0].id));
      } else {
        await db.insert(results).values({
          submissionId,
          score: mark.score.toString(),
          gradedByMembershipId,
          status: 'auto_marked',
        });
      }
    }

    revalidatePath(`/educator/rounds/${roundId}/offline-marks`);
    return { success: true };
  } catch (error) {
    console.error('Error saving bulk offline marks:', error);
    return { error: 'Failed to save marks' };
  }
}
