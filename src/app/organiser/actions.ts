'use server';

import { db } from '@/lib/db';
import {
  organiserApplications,
  portals,
  memberships,
  users,
} from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { sendInviteEmail } from '@/lib/email';
import { ensureSchool } from '@/lib/schools/db';
import { isSchoolType, type PickedSchool } from '@/lib/schools/types';

export async function submitOrganiserApplication(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const file = formData.get('applicationPdf') as File;

  if (!file) {
    return { error: 'Application PDF is required.' };
  }

  // Upload to Supabase Storage
  const fileExt = file.name.split('.').pop();
  const fileName = `${user.id}-${Date.now()}.${fileExt}`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('applications')
    .upload(fileName, file);

  if (uploadError) {
    console.error('Upload Error:', uploadError);
    return {
      error: 'Failed to upload PDF application. ' + uploadError.message,
    };
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from('applications').getPublicUrl(fileName);

  // Check if an application already exists
  const existingApp = await db.query.organiserApplications.findFirst({
    where: eq(organiserApplications.userId, user.id),
  });

  if (existingApp) {
    await db
      .update(organiserApplications)
      .set({
        pdfUrl: publicUrl,
        status: 'pending',
        updatedAt: new Date(),
      })
      .where(eq(organiserApplications.id, existingApp.id));
  } else {
    await db.insert(organiserApplications).values({
      userId: user.id,
      pdfUrl: publicUrl,
      status: 'pending',
    });
  }

  revalidatePath('/dashboard');
  revalidatePath('/organiser/dashboard');
}

export async function createPortal(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Verify user is an approved organiser
  const [application] = await db
    .select()
    .from(organiserApplications)
    .where(eq(organiserApplications.userId, user.id));

  if (!application || application.status !== 'approved') {
    return { error: 'You must be an approved organiser to create a portal.' };
  }

  const name = (formData.get('portalName') as string)?.trim();
  if (!name) {
    return { error: 'Portal name is required.' };
  }

  const schoolCount = parseInt(formData.get('schoolCount') as string, 10) || 0;

  // Parse picked school entries from form data. Schools always come from the
  // picker (name + type + external id), never from free-typed text.
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
      // Create the portal
      const [newPortal] = await tx
        .insert(portals)
        .values({
          ownerUserId: user.id,
          name,
          status: 'pending',
        })
        .returning();

      // Process each school entry: find-or-create the portal's row for the
      // picked school (re-used across entries within this transaction).
      for (const entry of schoolEntries) {
        const { id: schoolId, name: schoolName } = await ensureSchool(
          tx,
          newPortal.id,
          entry.school
        );

        // Create educator memberships
        if (entry.teacherEmails.length > 0) {
          const uniqueEmails = [...new Set(entry.teacherEmails)];

          for (const email of uniqueEmails) {
            const existingUserId = existingUserMap.get(email);

            if (existingUserId) {
              // Educator already has an account - link them directly
              await tx.insert(memberships).values({
                userId: existingUserId,
                portalId: newPortal.id,
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
                  portalId: newPortal.id,
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
          portalName: name,
          schoolName: invite.schoolName,
          inviteToken: invite.inviteToken,
        });
      } catch (emailErr) {
        // Log but don't fail the whole operation
        console.error(`Failed to send invite to ${invite.email}:`, emailErr);
      }
    }
  } catch (err: any) {
    console.error('Failed to create portal:', err);
    return { error: 'Failed to create portal. Please try again.' };
  }

  revalidatePath('/organiser/dashboard');
  return { success: true };
}
