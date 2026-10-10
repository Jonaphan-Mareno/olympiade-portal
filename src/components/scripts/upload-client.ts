import { createClient } from '@/lib/supabase/client';
import {
  MARKED_SCRIPTS_BUCKET,
  MAX_SCRIPT_PAGE_BYTES,
  SCRIPT_IMAGE_TYPES,
} from '@/domain/scripts/script-rules';
import type { ScriptUploadTarget } from '@/domain/scripts/script-pages';
import {
  commitScriptUploadAction,
  discardScriptUploadAction,
  prepareScriptUploadAction,
} from './actions';

// Browser side of a script upload: shrink phone photos, then
// prepare (server) → upload each page to its signed URL → commit (server).

const MAX_LONG_EDGE = 2400;
const JPEG_QUALITY = 0.85;

export const HEIC_HINT =
  'iPhone HEIC photos are not supported. Set the camera to "Most Compatible" (Settings → Camera → Formats) or export the photos as JPEG.';

/**
 * Downscales a page photo to at most 2400px on its long edge (JPEG, quality
 * 0.85). Small enough images are kept as they are.
 */
export async function preparePageImage(file: File): Promise<Blob> {
  if (!Object.prototype.hasOwnProperty.call(SCRIPT_IMAGE_TYPES, file.type)) {
    throw new Error(`${file.name}: only JPEG, PNG and WebP photos can be uploaded. ${HEIC_HINT}`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} could not be read as an image.`);
  }

  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (longEdge <= MAX_LONG_EDGE && file.size <= MAX_SCRIPT_PAGE_BYTES) {
    bitmap.close();
    return file;
  }

  const scale = Math.min(1, MAX_LONG_EDGE / longEdge);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not resize this photo.');
  // JPEG has no transparency: paper is white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  );
  if (!blob) throw new Error('Your browser could not resize this photo.');
  if (blob.size > MAX_SCRIPT_PAGE_BYTES) {
    throw new Error(`${file.name} is still larger than 10 MB after resizing.`);
  }
  return blob;
}

/** Uploads the pages in order, replacing the script for that target. */
export async function uploadScriptPages(
  target: ScriptUploadTarget,
  pages: Blob[]
): Promise<{ error?: string; pageCount?: number }> {
  const prepared = await prepareScriptUploadAction(
    target,
    pages.map((p) => ({ contentType: p.type, size: p.size }))
  );
  if (prepared.error || !prepared.uploads) {
    return { error: prepared.error ?? 'Could not start the upload.' };
  }

  const storage = createClient().storage.from(MARKED_SCRIPTS_BUCKET);
  for (const [i, upload] of prepared.uploads.entries()) {
    const { error } = await storage.uploadToSignedUrl(upload.path, upload.token, pages[i], {
      contentType: pages[i].type,
    });
    if (error) {
      await discardScriptUploadAction(target, prepared.uploads.map((u) => u.path));
      return { error: `Page ${i + 1} failed to upload. Please try again.` };
    }
  }

  const committed = await commitScriptUploadAction(
    target,
    prepared.uploads.map((u, i) => ({ path: u.path, contentType: pages[i].type }))
  );
  if (committed.error) return { error: committed.error };
  return { pageCount: committed.pageCount };
}
