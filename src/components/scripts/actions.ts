'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  commitScriptUpload,
  discardScriptUpload,
  prepareScriptUpload,
  type ScriptUploadTarget,
} from '@/domain/scripts/script-pages';

// Marked-script uploads, shared by the educator's offline-marks page
// (original pages) and the remark screens (re-marked pages). All checks run
// in domain/scripts/script-pages; nothing the browser sends is trusted.

export async function prepareScriptUploadAction(
  target: ScriptUploadTarget,
  files: { contentType: string; size: number }[]
): Promise<{ error?: string; uploads?: { path: string; token: string }[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  try {
    return await prepareScriptUpload(user.id, target, files);
  } catch (error) {
    console.error('Error preparing script upload:', error);
    return { error: 'Could not start the upload. Please try again.' };
  }
}

export async function commitScriptUploadAction(
  target: ScriptUploadTarget,
  pages: { path: string; contentType: string }[]
): Promise<{ success?: boolean; error?: string; pageCount?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  try {
    const result = await commitScriptUpload(user.id, target, pages);
    if ('error' in result) return { error: result.error };

    if (target.kind === 'original') {
      revalidatePath(`/educator/rounds/${target.roundId}/offline-marks`);
    }
    return { success: true, pageCount: result.pageCount };
  } catch (error) {
    console.error('Error saving script upload:', error);
    return { error: 'Could not save the script. Please try again.' };
  }
}

/** Best-effort cleanup after a page failed to upload. */
export async function discardScriptUploadAction(
  target: ScriptUploadTarget,
  paths: string[]
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  try {
    await discardScriptUpload(user.id, target, paths);
  } catch (error) {
    console.error('Error discarding script upload:', error);
  }
}
