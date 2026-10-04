'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { resolveRemarkRequest } from '@/domain/remarks/remarks';

/** Shared by the educator and organiser remark screens. */
export async function submitRemarkResolution(input: {
  requestId: string;
  note: string;
  questionMarks?: Record<string, number>;
  newTotal?: number;
}): Promise<{ error?: string; newScore?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const result = await resolveRemarkRequest(user.id, input);
  if (!result.error) {
    // Scores feed many screens; refresh them all
    revalidatePath('/', 'layout');
  }
  return result;
}
