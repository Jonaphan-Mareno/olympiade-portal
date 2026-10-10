'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_SCRIPT_PAGES } from '@/domain/scripts/script-rules';
import { HEIC_HINT, preparePageImage } from './upload-client';

export type PickedPage = { id: string; blob: Blob; url: string; name: string };

/**
 * Choose, order and remove script page photos before uploading. Photos are
 * shrunk in the browser as they are added. Controlled: the parent holds the
 * pages and uploads them with uploadScriptPages.
 */
export default function ScriptPagesPicker({
  pages,
  onChange,
  disabled,
}: {
  pages: PickedPage[];
  onChange: (pages: PickedPage[]) => void;
  disabled?: boolean;
}) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // Free the thumbnails' object URLs when the picker goes away
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const busy = disabled || processing;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_SCRIPT_PAGES - pages.length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) {
      setError(`A script can have at most ${MAX_SCRIPT_PAGES} pages.`);
    }

    setProcessing(true);
    const added: PickedPage[] = [];
    for (const file of chosen) {
      try {
        const blob = await preparePageImage(file);
        added.push({
          id: crypto.randomUUID(),
          blob,
          url: URL.createObjectURL(blob),
          name: file.name,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'A photo could not be added.');
      }
    }
    setProcessing(false);
    if (inputRef.current) inputRef.current.value = '';
    onChange([...pages, ...added]);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= pages.length) return;
    const next = [...pages];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const remove = (index: number) => {
    URL.revokeObjectURL(pages[index].url);
    onChange(pages.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled || processing || pages.length >= MAX_SCRIPT_PAGES}
          onChange={(e) => handleFiles(e.target.files)}
          className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-4 file:border-2 file:border-slate-300 file:bg-white file:font-bold file:text-slate-700 hover:file:border-blue-900"
        />
        <p className="text-xs text-slate-500 mt-1">
          JPEG, PNG or WebP, up to {MAX_SCRIPT_PAGES} pages, 10 MB each. Large photos are
          resized automatically. {HEIC_HINT}
        </p>
      </div>

      {processing && <p className="text-sm text-slate-600">Preparing photos…</p>}
      {error && (
        <div className="px-3 py-2 bg-red-50 text-red-700 text-sm font-bold border-l-4 border-red-500">
          {error}
        </div>
      )}

      {pages.length > 0 && (
        <ol className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {pages.map((page, i) => (
            <li key={page.id} className="border-2 border-slate-200 bg-white">
              {/* Local preview of a photo that has not been uploaded yet */}
              <img src={page.url} alt={`Page ${i + 1}`} className="block w-full h-32 object-cover" />
              <div className="flex items-center justify-between px-2 py-1 text-xs">
                <span className="font-bold text-slate-700">Page {i + 1}</span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, i - 1)}
                    disabled={busy || i === 0}
                    className="px-1.5 font-bold text-slate-600 disabled:opacity-30"
                    aria-label={`Move page ${i + 1} earlier`}
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, i + 1)}
                    disabled={busy || i === pages.length - 1}
                    className="px-1.5 font-bold text-slate-600 disabled:opacity-30"
                    aria-label={`Move page ${i + 1} later`}
                  >
                    &darr;
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    disabled={busy}
                    className="px-1.5 font-bold text-red-600 disabled:opacity-30"
                    aria-label={`Remove page ${i + 1}`}
                  >
                    &times;
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
