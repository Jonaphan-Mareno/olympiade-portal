'use server';

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { sendInviteEmail } from '@/lib/email';
import { ensureSchool } from '@/lib/schools/db';
import { isSchoolType, type PickedSchool } from '@/lib/schools/types';
import { inviteEducatorsToSchool } from '@/lib/invites';

export async function sendInvitations(portalId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const schoolCount = parseInt(formData.get('schoolCount') as string, 10) || 0;

  // Parse picked school entries from form data. Schools always come from the
  // picker (name + type + external id), never from free-typed text, so a
  // school can only ever resolve to a row scoped to this portal.
  const schoolEntries: {
    school: PickedSchool;
    teacherEmails: string[];
  }[] = [];
  for (let i = 0; i < schoolCount; i++) {
    const name = (formData.get(`school_name_${i}`) as string)?.trim() || '';
    const type = (formData.get(`school_type_${i}`) as string)?.trim() || '';
    const externalId =
      (formData.get(`school_externalId_${i}`) as string)?.trim() || null;
    const teacherEmails = formData
      .getAll(`school_teacherEmails_${i}`)
      .map((e) => (e as string).trim().toLowerCase())
      .filter((e) => e.length > 0 && e.includes('@'));

    if (name && isSchoolType(type)) {
      schoolEntries.push({ school: { name, type, externalId }, teacherEmails });
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
      // Process each school entry: find-or-create the portal's row for the
      // picked school, so re-inviting a school reuses its existing row.
      for (const entry of schoolEntries) {
        const { id: schoolId, name: schoolName } = await ensureSchool(
          tx,
          portalId,
          entry.school
        );

        // Create educator memberships (deduplicated per invited email)
        if (entry.teacherEmails.length > 0) {
          await inviteEducatorsToSchool(tx, {
            portalId,
            schoolId,
            schoolName,
            emails: [...new Set(entry.teacherEmails)],
            existingUserIds: existingUserMap,
            invitesToSend,
          });
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
