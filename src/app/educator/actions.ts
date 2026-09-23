'use server';

import { db } from '@/lib/db';
import { memberships, users, portals, schools } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { sendInviteEmail } from '@/lib/email';

export async function inviteStudents(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const portalId = (formData.get('portalId') as string)?.trim();
  const schoolId = (formData.get('schoolId') as string)?.trim();

  if (!portalId || !schoolId) {
    return { error: 'Portal and school are required.' };
  }

  // Verify the user is an educator for this portal + school
  const [educatorMembership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.portalId, portalId),
        eq(memberships.schoolId, schoolId),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    );

  if (!educatorMembership) {
    return { error: 'You are not an educator for this school.' };
  }

  // Parse student emails
  const emails = formData
    .getAll('studentEmails')
    .map((e) => (e as string).trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes('@'));

  if (emails.length === 0) {
    return { error: 'At least one student email is required.' };
  }

  const uniqueEmails = [...new Set(emails)];

  // Look up existing users
  const existingUsers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, uniqueEmails));
  const existingUserMap = new Map(existingUsers.map((u) => [u.email, u.id]));

  // Look up portal and school names for the email
  const [[portal], [school]] = await Promise.all([
    db
      .select({ name: portals.name })
      .from(portals)
      .where(eq(portals.id, portalId)),
    db
      .select({ name: schools.name, portalId: schools.portalId })
      .from(schools)
      .where(eq(schools.id, schoolId)),
  ]);

  // Defense in depth: a school row from another portal must never receive
  // this portal's students (the educator's own membership is already
  // portal-checked above, but legacy rows may predate that guard).
  if (!school || school.portalId !== portalId) {
    return {
      error:
        'This school does not belong to your olympiad. Please refresh and try again.',
    };
  }

  const invitesToSend: { email: string; inviteToken: string }[] = [];

  try {
    for (const email of uniqueEmails) {
      const existingUserId = existingUserMap.get(email);

      // A membership is unique per (portal, invited email): re-inviting an
      // address that is already a member must not crash, and a pending invite
      // whose owner has since created an account should be linked, not left
      // dangling as 'invited'.
      const [existingMembership] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.portalId, portalId),
            eq(memberships.invitedEmail, email)
          )
        );

      if (existingMembership?.status === 'accepted') {
        // Already a member of this portal — nothing to do.
        continue;
      }

      if (!existingMembership) {
        if (existingUserId) {
          // Student already has an account - link directly
          await db
            .insert(memberships)
            .values({
              userId: existingUserId,
              portalId,
              schoolId,
              role: 'student',
              status: 'accepted',
              invitedEmail: email,
            })
            .onConflictDoNothing();
        } else {
          // No account yet - create invite
          const [membership] = await db
            .insert(memberships)
            .values({
              portalId,
              schoolId,
              role: 'student',
              status: 'invited',
              invitedEmail: email,
            })
            .returning();

          invitesToSend.push({
            email,
            inviteToken: membership.inviteToken!,
          });
        }
      } else if (existingUserId) {
        // Pending invite, but the account now exists — link and accept
        await db
          .update(memberships)
          .set({
            userId: existingUserId,
            schoolId,
            status: 'accepted',
            claimedAt: new Date(),
          })
          .where(eq(memberships.id, existingMembership.id));
      } else {
        // Pending invite, still no account — re-send the original token,
        // refreshed to point at this school
        await db
          .update(memberships)
          .set({ schoolId })
          .where(eq(memberships.id, existingMembership.id));

        invitesToSend.push({
          email,
          inviteToken: existingMembership.inviteToken!,
        });
      }
    }

    // Send invite emails after DB operations
    for (const invite of invitesToSend) {
      try {
        await sendInviteEmail({
          to: invite.email,
          portalName: portal?.name ?? 'Olympiad',
          schoolName: school?.name ?? 'School',
          inviteToken: invite.inviteToken,
          role: 'student',
        });
      } catch (emailErr) {
        console.error(`Failed to send invite to ${invite.email}:`, emailErr);
      }
    }
  } catch (err: any) {
    console.error('Failed to invite students:', err);
    return { error: 'Failed to invite students. Please try again.' };
  }

  revalidatePath('/educator');
  revalidatePath('/educator/entrants');
  revalidatePath(`/organiser/olympiads/${portalId}`);
  return { success: true, count: uniqueEmails.length };
}
