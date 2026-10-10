import { createClient } from '@supabase/supabase-js';
import { MARKED_SCRIPTS_BUCKET } from '@/domain/scripts/script-rules';

// The private `marked-scripts` bucket (see create-marked-scripts-bucket.mjs).
// It has no storage policies, so every call goes through the service role and
// must only ever run on the server, after the caller has been authorised.
// Never hand out public URLs for these objects.

function bucket() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Script storage is not configured (SUPABASE_SERVICE_ROLE_KEY).');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(MARKED_SCRIPTS_BUCKET);
}

/** A one-off signed URL the browser uploads one page to (no overwrite). */
export async function createScriptUploadUrl(
  path: string
): Promise<{ path: string; token: string } | null> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) {
    console.error('Failed to create script upload URL:', error);
    return null;
  }
  return { path: data.path, token: data.token };
}

export async function downloadScriptObject(path: string): Promise<Blob | null> {
  const { data, error } = await bucket().download(path);
  if (error || !data) return null;
  return data;
}

/** Best-effort delete; failures are logged, never thrown. */
export async function removeScriptObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await bucket().remove(paths);
    if (error) console.error('Failed to remove script objects:', error);
  } catch (err) {
    console.error('Failed to remove script objects:', err);
  }
}
