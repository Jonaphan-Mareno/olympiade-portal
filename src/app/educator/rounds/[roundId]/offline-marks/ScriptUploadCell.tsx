'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ScriptPagesPicker, { type PickedPage } from '@/components/scripts/ScriptPagesPicker';
import { uploadScriptPages } from '@/components/scripts/upload-client';

/**
 * One entrant's marked script on the offline-marks page: its status, and a
 * dialog to upload or replace it. Independent of saving the marks.
 */
export default function ScriptUploadCell({
  roundId,
  studentMembershipId,
  studentName,
  pageCount,
}: {
  roundId: string;
  studentMembershipId: string;
  studentName: string;
  pageCount: number;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [pages, setPages] = useState<PickedPage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
    setError(null);
    setIsOpen(false);
  };

  const handleUpload = async () => {
    if (pages.length === 0) {
      setError('Add at least one page.');
      return;
    }
    setIsUploading(true);
    setError(null);
    const result = await uploadScriptPages(
      { kind: 'original', roundId, studentMembershipId },
      pages.map((p) => p.blob)
    );
    setIsUploading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    close();
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`text-xs font-bold ${pageCount > 0 ? 'text-green-700' : 'text-slate-500'}`}>
        {pageCount > 0
          ? `Script uploaded (${pageCount} page${pageCount === 1 ? '' : 's'})`
          : 'No script'}
      </span>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="text-xs font-bold text-blue-900 hover:underline"
      >
        {pageCount > 0 ? 'Replace script' : 'Upload marked script'}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-none border-2 border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b-2 border-slate-200 bg-slate-50">
              <h3 className="text-lg font-bold text-blue-950 font-serif">Marked script — {studentName}</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600 font-medium">
                Photograph or scan every page of the script after marking, with your
                ticks, crosses and marks visible, in page order. The entrant sees it
                once results are published.
                {pageCount > 0 && ' Uploading replaces the current script.'}
              </p>
              <ScriptPagesPicker pages={pages} onChange={setPages} disabled={isUploading} />
              {error && (
                <div className="p-3 bg-red-50 text-red-700 text-sm font-bold border-l-4 border-red-500">
                  {error}
                </div>
              )}
              <div className="flex justify-end gap-4 pt-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={isUploading}
                  className="px-6 py-3 text-sm font-bold text-slate-700 uppercase tracking-wider hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={isUploading || pages.length === 0}
                  className="px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-blue-950 hover:bg-blue-900 transition-colors disabled:opacity-50"
                >
                  {isUploading
                    ? 'Uploading…'
                    : `Save script${pages.length > 0 ? ` (${pages.length} page${pages.length === 1 ? '' : 's'})` : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
