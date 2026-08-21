'use server';

import { db } from '@/lib/db';
import { organiserApplications, portals, schools, memberships, users } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { sendInviteEmail } from '@/lib/email';

export async function submitOrganiserApplication(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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
    return { error: 'Failed to upload PDF application. ' + uploadError.message };
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('applications')
    .getPublicUrl(fileName);

  // Check if an application already exists
  const existingApp = await db.query.organiserApplications.findFirst({
    where: eq(organiserApplications.userId, user.id),
  });

  if (existingApp) {
    await db.update(organiserApplications)
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
  const { data: { user } } = await supabase.auth.getUser();

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

  // Parse school entries from form data
  const schoolEntries: { existingId: string | null; newName: string; teacherEmails: string[] }[] = [];
  for (let i = 0; i < schoolCount; i++) {
    const existingId = (formData.get(`school_existingId_${i}`) as string)?.trim() || null;
    const newName = (formData.get(`school_newName_${i}`) as string)?.trim() || '';
    const teacherEmails = formData.getAll(`school_teacherEmails_${i}`)
      .map(e => (e as string).trim().toLowerCase())
      .filter(e => e.length > 0 && e.includes('@'));

    // Must have either an existing school ID or a new name
    if (existingId || newName) {
      schoolEntries.push({ existingId, newName, teacherEmails });
    }
  }

  // Collect all unique teacher emails across all schools for a single lookup
  const allEmails = [...new Set(schoolEntries.flatMap(e => e.teacherEmails))];
  const existingUsers = allEmails.length > 0
    ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, allEmails))
    : [];
  const existingUserMap = new Map(existingUsers.map(u => [u.email, u.id]));

  // Track invites to send after the transaction
  const invitesToSend: { email: string; schoolName: string; inviteToken: string }[] = [];

  try {
    await db.transaction(async (tx) => {
      // Create the portal
      const [newPortal] = await tx.insert(portals)
        .values({
          ownerUserId: user.id,
          name,
          status: 'pending',
        })
        .returning();

      // Process each school entry
      for (const entry of schoolEntries) {
        let schoolId: string;
        let schoolName: string;

        if (entry.existingId) {
          // Use an existing school - look up its name
          schoolId = entry.existingId;
          const [existingSchool] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, entry.existingId));
          schoolName = existingSchool?.name ?? entry.newName;
        } else {
          // Create a new school
          const [newSchool] = await tx.insert(schools)
            .values({
              portalId: newPortal.id,
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
                portalId: newPortal.id,
                schoolId,
                role: 'educator',
                status: 'accepted',
                invitedEmail: email,
              });
            } else {
              // No account yet - create invite and track for email
              const [membership] = await tx.insert(memberships).values({
                portalId: newPortal.id,
                schoolId,
                role: 'educator',
                status: 'invited',
                invitedEmail: email,
              }).returning();

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
