'use server';

import { db } from '@/lib/db';
import { results } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getRoundTotalMarks } from '@/domain/rounds/score-percentage';
import {
  checkEntrantsAtEducatorSchools,
  findOrCreateOfflineSubmission,
  loadOfflineMarkingRound,
} from '@/domain/rounds/offline-marks';

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

  const loaded = await loadOfflineMarkingRound(user.id, roundId);
  if ('error' in loaded) return { error: loaded.error };
  const { round, educatorBySchool } = loaded;

  const totalMarks = (await getRoundTotalMarks([roundId])).get(roundId) ?? 0;

  const entries = marksData.filter((m) => !isNaN(m.score));
  for (const mark of entries) {
    if (mark.score < 0 || (totalMarks > 0 && mark.score > totalMarks)) {
      return {
        error: totalMarks > 0
          ? `Marks must be between 0 and ${totalMarks}.`
          : 'Marks cannot be negative.',
      };
    }
  }

  const checked = await checkEntrantsAtEducatorSchools(
    round,
    educatorBySchool,
    entries.map((m) => m.studentMembershipId)
  );
  if ('error' in checked) return { error: checked.error };
  const { studentSchool } = checked;

  try {
    for (const mark of entries) {
      const gradedByMembershipId = educatorBySchool.get(
        studentSchool.get(mark.studentMembershipId) ?? null
      )!;

      const submissionId = await findOrCreateOfflineSubmission(
        roundId,
        mark.studentMembershipId,
        gradedByMembershipId
      );
      // Never overwrite a script the entrant wrote online
      if (!submissionId) continue;

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
