'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { portals, rounds, schools, users } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { deriveRoundState } from '@/domain/rounds/round-state-machine';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sendInviteEmail } from '@/lib/email';
import { inviteEducatorsToSchool, type PendingInvite } from '@/lib/invites';

export async function deleteOlympiad(portalId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  // We should enforce that the user is the owner, or is a platform admin, but
  // for now we'll just check that they own it.
  const [portal] = await db
    .select()
    .from(portals)
    .where(and(eq(portals.id, portalId), eq(portals.ownerUserId, user.id)));

  if (!portal) {
    throw new Error('Not authorized to delete this portal');
  }

  const portalRounds = await db.select().from(rounds).where(eq(rounds.portalId, portalId));
  const now = new Date();
  const hasStartedRounds = portalRounds.some(round => {
    const state = deriveRoundState(round, now);
    return state !== 'scheduled';
  });

  if (hasStartedRounds) {
    throw new Error('Cannot delete an Olympiad that has rounds which have already opened or started.');
  }

  // Due to ON DELETE CASCADE on our foreign keys in schema.ts,
  // this will cleanly delete rounds, schools, and memberships.
  await db.delete(portals).where(eq(portals.id, portalId));

  revalidatePath('/organiser/dashboard');
  redirect('/organiser/dashboard');
}

// Invite additional educators to a school that already participates in the
// olympiad. Keyed by the school's own row id, so every school on the detail
// page can gain educators later — including ones whose name no longer (or
// never did) resolve through the school-picker directories.
export async function addEducators(
  portalId: string,
  schoolId: string,
  formData: FormData
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'You must be signed in to add educators.' };
  }

  const emails = [
    ...new Set(
      formData
        .getAll('teacherEmails')
        .map((e) => (e as string).trim().toLowerCase())
        .filter((e) => e.length > 0 && e.includes('@'))
    ),
  ];

  if (emails.length === 0) {
    return { error: 'Enter at least one valid educator email address.' };
  }

  const invitesToSend: PendingInvite[] = [];

  try {
    // The school must belong to this olympiad — a tampered schoolId must
    // not attach educators to some other portal's school.
    const [school] = await db
      .select({ id: schools.id, name: schools.name })
      .from(schools)
      .where(and(eq(schools.id, schoolId), eq(schools.portalId, portalId)));

    if (!school) {
      return { error: 'This school is not part of the olympiad.' };
    }

    const [portal] = await db
      .select({ name: portals.name })
      .from(portals)
      .where(eq(portals.id, portalId));

    const existingUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.email, emails));
    const existingUserMap = new Map(existingUsers.map((u) => [u.email, u.id]));

    await db.transaction(async (tx) => {
      await inviteEducatorsToSchool(tx, {
        portalId,
        schoolId: school.id,
        schoolName: school.name,
        emails,
        existingUserIds: existingUserMap,
        invitesToSend,
      });
    });

    // Send invite emails after the transaction commits
    for (const invite of invitesToSend) {
      try {
        await sendInviteEmail({
          to: invite.email,
          portalName: portal?.name ?? 'Olympiad Portal',
          schoolName: invite.schoolName,
          inviteToken: invite.inviteToken,
        });
      } catch (emailErr) {
        console.error(`Failed to send invite to ${invite.email}:`, emailErr);
      }
    }
  } catch (err: any) {
    console.error('Failed to add educators:', err);
    return { error: 'Failed to add educators. Please try again.' };
  }

  // The dialog lives on the olympiad page itself, so revalidating the path
  // is enough — the schools list re-renders with the new educators.
  revalidatePath(`/organiser/olympiads/${portalId}`);
}
