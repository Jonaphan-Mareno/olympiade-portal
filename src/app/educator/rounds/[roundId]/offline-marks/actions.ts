'use server';

import { db } from '@/lib/db';
import { submissions, results, memberships, rounds } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getMarkingWindowStatus } from '@/domain/rounds/paper-marking';
import { getRoundTotalMarks } from '@/domain/rounds/score-percentage';

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

  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round) return { error: 'Round not found' };
  if (round.deliveryMethod === 'online') {
    return { error: 'This round is written online, so marks cannot be entered manually.' };
  }

  const markingWindow = getMarkingWindowStatus(round);
  if (markingWindow.status !== 'open') return { error: markingWindow.reason };

  // The educator's accepted memberships in this olympiad, by school
  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.portalId, round.portalId),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    );
  if (educatorMemberships.length === 0) {
    return { error: 'Not authorized' };
  }
  const educatorBySchool = new Map(
    educatorMemberships.map((m) => [m.schoolId, m.id])
  );

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

  // Every student must be an entrant of this olympiad at one of the
  // educator's schools
  const studentIds = entries.map((m) => m.studentMembershipId);
  const students = studentIds.length > 0
    ? await db
        .select({ id: memberships.id, schoolId: memberships.schoolId })
        .from(memberships)
        .where(
          and(
            inArray(memberships.id, studentIds),
            eq(memberships.portalId, round.portalId),
            eq(memberships.role, 'student')
          )
        )
    : [];
  const studentSchool = new Map(students.map((s) => [s.id, s.schoolId]));
  if (studentIds.some((id) => !educatorBySchool.has(studentSchool.get(id) ?? null))) {
    return { error: 'You can only enter marks for entrants at your school.' };
  }

  try {
    for (const mark of entries) {
      const gradedByMembershipId = educatorBySchool.get(
        studentSchool.get(mark.studentMembershipId) ?? null
      )!;

      const existingSubmissions = await db.select().from(submissions).where(
        and(
          eq(submissions.roundId, roundId),
          eq(submissions.studentMembershipId, mark.studentMembershipId)
        )
      );

      // Never overwrite a script the entrant wrote online
      if (existingSubmissions.some((s) => s.submissionType === 'online')) continue;

      let submissionId: string;

      if (existingSubmissions.length > 0) {
        submissionId = existingSubmissions[0].id;
      } else {
        // Create an offline submission. Race-safe against the unique
        // (student_membership_id, round_id) index: a concurrent online submit
        // may create the row between the read above and this insert, so use
        // ON CONFLICT DO NOTHING and re-read rather than erroring the whole batch.
        const newSubmissions = await db.insert(submissions).values({
          roundId,
          studentMembershipId: mark.studentMembershipId,
          submittedByMembershipId: gradedByMembershipId,
          submissionType: 'offline',
          status: 'submitted',
          submittedAt: new Date(),
        }).onConflictDoNothing().returning({ id: submissions.id });

        if (newSubmissions.length > 0) {
          submissionId = newSubmissions[0].id;
        } else {
          // Lost the race: re-read the winner. First is final — never overwrite
          // a script the entrant wrote online, so skip it if that is what won.
          const [winner] = await db.select().from(submissions).where(
            and(
              eq(submissions.roundId, roundId),
              eq(submissions.studentMembershipId, mark.studentMembershipId)
            )
          ).limit(1);
          if (!winner || winner.submissionType === 'online') continue;
          submissionId = winner.id;
        }
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
