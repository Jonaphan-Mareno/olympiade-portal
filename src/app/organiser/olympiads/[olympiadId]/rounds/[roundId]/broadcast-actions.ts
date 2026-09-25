'use server';

import { createClient } from '@/lib/supabase/server';
import { notifyEducatorsInPortal } from '@/domain/notifications/in-app-notifications';

export async function sendBroadcastNotification(portalId: string, roundId: string, title: string, message: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await notifyEducatorsInPortal(
      portalId,
      title,
      message,
      `/educator/olympiads/${portalId}/rounds/${roundId}`
    );

    return { success: true };
  } catch (error: any) {
    console.error('Error broadcasting notification:', error);
    return { success: false, error: error.message };
  }
}
