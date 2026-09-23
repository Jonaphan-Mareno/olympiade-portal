import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { memberships } from '@/lib/db/schema';

// Whatever Drizzle hands the db.transaction callback.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// An invite whose email should go out once the transaction commits.
export type PendingInvite = {
  email: string;
  schoolName: string;
  inviteToken: string;
};

// Create or refresh educator memberships for one school, honouring the
// (portal, invited email) unique constraint instead of crashing on it:
// - accepted member  -> no-op
// - no membership    -> link an existing account directly, or insert a
//                       pending invite the email can claim at signup
// - pending invite   -> link a since-created account, or re-point the
//                       original token at this school and re-send it
//
// Shared by the multi-school invite flow and the per-school "Add Educator"
// action so both grow educators the same way.
export async function inviteEducatorsToSchool(
  tx: Tx,
  opts: {
    portalId: string;
    schoolId: string;
    schoolName: string;
    emails: string[];
    // email -> user id for accounts that already exist
    existingUserIds: Map<string, string>;
    // appended here for the caller to email after the commit
    invitesToSend: PendingInvite[];
  }
): Promise<void> {
  for (const email of opts.emails) {
    const existingUserId = opts.existingUserIds.get(email);

    const [existingMembership] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.portalId, opts.portalId),
          eq(memberships.invitedEmail, email)
        )
      );

    if (existingMembership?.status === 'accepted') {
      // Already a member of this portal — nothing to do.
      continue;
    }

    if (!existingMembership) {
      if (existingUserId) {
        // Educator already has an account - link them directly
        await tx.insert(memberships).values({
          userId: existingUserId,
          portalId: opts.portalId,
          schoolId: opts.schoolId,
          role: 'educator',
          status: 'accepted',
          invitedEmail: email,
        });
      } else {
        // No account yet - create invite and track for email
        const [membership] = await tx
          .insert(memberships)
          .values({
            portalId: opts.portalId,
            schoolId: opts.schoolId,
            role: 'educator',
            status: 'invited',
            invitedEmail: email,
          })
          .returning();

        opts.invitesToSend.push({
          email,
          schoolName: opts.schoolName,
          inviteToken: membership.inviteToken!,
        });
      }
    } else if (existingUserId) {
      // Pending invite, but the account now exists — link and accept
      await tx
        .update(memberships)
        .set({
          userId: existingUserId,
          schoolId: opts.schoolId,
          status: 'accepted',
          claimedAt: new Date(),
        })
        .where(eq(memberships.id, existingMembership.id));
    } else {
      // Pending invite, still no account — re-send the original
      // token, refreshed to point at this school
      await tx
        .update(memberships)
        .set({ schoolId: opts.schoolId })
        .where(eq(memberships.id, existingMembership.id));

      opts.invitesToSend.push({
        email,
        schoolName: opts.schoolName,
        inviteToken: existingMembership.inviteToken!,
      });
    }
  }
}
