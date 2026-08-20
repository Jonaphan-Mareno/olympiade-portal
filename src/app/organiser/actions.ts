'use server';

import { db } from '@/lib/db';
import { organiserApplications } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

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
