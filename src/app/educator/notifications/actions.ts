'use server';

import { db } from '@/lib/db';
import { inAppNotifications } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, desc, and } from 'drizzle-orm';

export async function getUnreadNotifications() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return [];

  const notifications = await db
    .select()
    .from(inAppNotifications)
    .where(
      and(
        eq(inAppNotifications.userId, user.id),
        eq(inAppNotifications.isRead, false)
      )
    )
    .orderBy(desc(inAppNotifications.createdAt))
    .limit(10);

  return notifications;
}

export async function markAsRead(notificationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  await db
    .update(inAppNotifications)
    .set({ isRead: true })
    .where(
      and(
        eq(inAppNotifications.id, notificationId),
        eq(inAppNotifications.userId, user.id)
      )
    );
}

export async function markAllAsRead() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  await db
    .update(inAppNotifications)
    .set({ isRead: true })
    .where(
      and(
        eq(inAppNotifications.userId, user.id),
        eq(inAppNotifications.isRead, false)
      )
    );
}
