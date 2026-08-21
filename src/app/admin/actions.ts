'use server';

import { db } from '@/lib/db';
import { organiserApplications } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { users } from '@/lib/db/schema';
import { redirect } from 'next/navigation';

async function verifyPlatformAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  
  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id));
  return dbUser?.isPlatformAdmin === true;
}

export async function approveApplication(formData: FormData) {
  if (!(await verifyPlatformAdmin())) {
    redirect('/dashboard');
  }

  const applicationId = formData.get('applicationId') as string;
  if (!applicationId) return;

  await db.update(organiserApplications)
    .set({
      status: 'approved',
      updatedAt: new Date(),
    })
    .where(eq(organiserApplications.id, applicationId));

  revalidatePath('/admin/dashboard');
}

export async function denyApplication(formData: FormData) {
  if (!(await verifyPlatformAdmin())) {
    redirect('/dashboard');
  }

  const applicationId = formData.get('applicationId') as string;
  if (!applicationId) return;

  await db.update(organiserApplications)
    .set({
      status: 'rejected',
      updatedAt: new Date(),
    })
    .where(eq(organiserApplications.id, applicationId));

  revalidatePath('/admin/dashboard');
}
