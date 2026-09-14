'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { portals } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

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

  // Due to ON DELETE CASCADE on our foreign keys in schema.ts,
  // this will cleanly delete rounds, schools, and memberships.
  await db.delete(portals).where(eq(portals.id, portalId));

  revalidatePath('/organiser/dashboard');
  redirect('/organiser/dashboard');
}
