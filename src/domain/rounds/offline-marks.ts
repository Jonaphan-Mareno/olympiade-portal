// Shared checks for school educators working on paper (offline) scripts:
// entering totals and uploading the marked script both go through these, so
// the two can never disagree about who may touch which entrant.

import { db } from '@/lib/db';
import { memberships, rounds, submissions } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { getMarkingWindowStatus } from './paper-marking';

export type OfflineMarkingRound = typeof rounds.$inferSelect;

/**
 * The round, if the user is an accepted educator of its olympiad, it is not
 * written online and the marking window is open. `educatorBySchool` maps each
 * of the educator's schools to their membership id there.
 */
export async function loadOfflineMarkingRound(
  userId: string,
  roundId: string,
  now: Date = new Date()
): Promise<
  | { error: string }
  | { round: OfflineMarkingRound; educatorBySchool: Map<string | null, string> }
> {
  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round) return { error: 'Round not found' };
  if (round.deliveryMethod === 'online') {
    return { error: 'This round is written online, so marks cannot be entered manually.' };
  }

  const markingWindow = getMarkingWindowStatus(round, now);
  if (markingWindow.status !== 'open') return { error: markingWindow.reason };

  // The educator's accepted memberships in this olympiad, by school
  const educatorMemberships = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.portalId, round.portalId),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    );
  if (educatorMemberships.length === 0) {
    return { error: 'Not authorized' };
  }
  return {
    round,
    educatorBySchool: new Map(educatorMemberships.map((m) => [m.schoolId, m.id])),
  };
}

/**
 * Every student must be an entrant of this olympiad at one of the educator's
 * schools. Returns each entrant's school.
 */
export async function checkEntrantsAtEducatorSchools(
  round: Pick<OfflineMarkingRound, 'portalId'>,
  educatorBySchool: Map<string | null, string>,
  studentIds: string[]
): Promise<{ error: string } | { studentSchool: Map<string, string | null> }> {
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
  return { studentSchool };
}

/**
 * The entrant's offline submission for the round, created if they have none.
 * Returns null when they wrote the round online: that script is never
 * overwritten.
 */
export async function findOrCreateOfflineSubmission(
  roundId: string,
  studentMembershipId: string,
  gradedByMembershipId: string
): Promise<string | null> {
  const existingSubmissions = await db.select().from(submissions).where(
    and(
      eq(submissions.roundId, roundId),
      eq(submissions.studentMembershipId, studentMembershipId)
    )
  );

  // Never overwrite a script the entrant wrote online
  if (existingSubmissions.some((s) => s.submissionType === 'online')) return null;

  if (existingSubmissions.length > 0) return existingSubmissions[0].id;

  // Create an offline submission
  const newSubmissions = await db.insert(submissions).values({
    roundId,
    studentMembershipId,
    submittedByMembershipId: gradedByMembershipId,
    submissionType: 'offline',
    status: 'submitted',
    submittedAt: new Date(),
  }).returning({ id: submissions.id });
  return newSubmissions[0].id;
}
