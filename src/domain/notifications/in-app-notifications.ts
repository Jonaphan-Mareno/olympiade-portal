import { db } from '@/lib/db';
import { inAppNotifications, users, memberships } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function notifyEducatorsInPortal(
  portalId: string,
  title: string,
  message: string,
  linkUrl: string | null = null
) {
  // Find all educators in this portal
  const educatorMemberships = await db
    .select({
      userId: memberships.userId,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.portalId, portalId),
        eq(memberships.role, 'educator'),
        eq(memberships.status, 'accepted')
      )
    );

  const notificationsToInsert = educatorMemberships
    .filter(m => m.userId !== null) // Only actual users can receive in-app notifications
    .map(m => ({
      userId: m.userId!,
      title,
      message,
      linkUrl,
    }));

  if (notificationsToInsert.length > 0) {
    await db.insert(inAppNotifications).values(notificationsToInsert);
  }
}
