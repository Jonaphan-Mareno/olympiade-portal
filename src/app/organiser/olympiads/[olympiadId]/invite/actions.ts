'use server';

import { db } from '@/lib/db';
import { schools, memberships, users } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { sendInviteEmail } from '@/lib/email';

export async function sendInvitations(portalId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const schoolCount = parseInt(formData.get('schoolCount') as string, 10) || 0;

  // Parse school entries from form data
  const schoolEntries: {
    existingId: string | null;
    newName: string;
    teacherEmails: string[];
  }[] = [];
  for (let i = 0; i < schoolCount; i++) {
    const existingId =
      (formData.get(`school_existingId_${i}`) as string)?.trim() || null;
    const newName =
      (formData.get(`school_newName_${i}`) as string)?.trim() || '';
    const teacherEmails = formData
      .getAll(`school_teacherEmails_${i}`)
      .map((e) => (e as string).trim().toLowerCase())
      .filter((e) => e.length > 0 && e.includes('@'));

    if (existingId || newName) {
      schoolEntries.push({ existingId, newName, teacherEmails });
    }
  }

  // Collect all unique teacher emails across all schools for a single lookup
  const allEmails = [...new Set(schoolEntries.flatMap((e) => e.teacherEmails))];
  const existingUsers =
    allEmails.length > 0
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.email, allEmails))
      : [];
  const existingUserMap = new Map(existingUsers.map((u) => [u.email, u.id]));

  // Track invites to send after the transaction
  const invitesToSend: {
    email: string;
    schoolName: string;
    inviteToken: string;
  }[] = [];

  try {
    await db.transaction(async (tx) => {
      // Process each school entry
      for (const entry of schoolEntries) {
        let schoolId: string;
        let schoolName: string;

        if (entry.existingId) {
          // Use an existing school
          schoolId = entry.existingId;
          const [existingSchool] = await tx
            .select({ name: schools.name })
            .from(schools)
            .where(eq(schools.id, entry.existingId));
          schoolName = existingSchool?.name ?? entry.newName;
        } else {
          // Create a new school
          const [newSchool] = await tx
            .insert(schools)
            .values({
              portalId,
              name: entry.newName,
            })
            .returning();
          schoolId = newSchool.id;
          schoolName = newSchool.name;
        }

        // Create educator memberships
        if (entry.teacherEmails.length > 0) {
          const uniqueEmails = [...new Set(entry.teacherEmails)];

          for (const email of uniqueEmails) {
            const existingUserId = existingUserMap.get(email);

            if (existingUserId) {
              // Educator already has an account - link them directly
              await tx.insert(memberships).values({
                userId: existingUserId,
                portalId,
                schoolId,
                role: 'educator',
                status: 'accepted',
                invitedEmail: email,
              });
            } else {
              // No account yet - create invite and track for email
              const [membership] = await tx
                .insert(memberships)
                .values({
                  portalId,
                  schoolId,
                  role: 'educator',
                  status: 'invited',
                  invitedEmail: email,
                })
                .returning();

              invitesToSend.push({
                email,
                schoolName,
                inviteToken: membership.inviteToken!,
              });
            }
          }
        }
      }
    });

    // Send invite emails after the transaction commits
    for (const invite of invitesToSend) {
      try {
        await sendInviteEmail({
          to: invite.email,
          portalName: 'Olympiad Portal', // Fallback name
          schoolName: invite.schoolName,
          inviteToken: invite.inviteToken,
        });
      } catch (emailErr) {
        console.error(`Failed to send invite to ${invite.email}:`, emailErr);
      }
    }
  } catch (err: any) {
    console.error('Failed to send invitations:', err);
    return { error: 'Failed to send invitations. Please try again.' };
  }

  revalidatePath(`/organiser/olympiads/${portalId}`);
  redirect(`/organiser/olympiads/${portalId}`);
}
