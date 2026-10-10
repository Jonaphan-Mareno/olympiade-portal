'use client';

import { useState } from 'react';
import type { ScriptPin } from '@/domain/scripts/script-rules';
import { PinOverlay } from './PinOverlay';

export type ScriptPageSet = {
  key: string;
  label: string;
  pageIds: string[];
  pins?: ScriptPin[];
};

/**
 * Pages of a marked script, one at a time and full width, served through
 * /api/scripts/[pageId]. Several sets (e.g. "Original" and "After remark")
 * get tabs. With `onPageTap`, tapping the first set's page reports where, as
 * fractions of the page, so the caller can drop a pin there.
 */
export default function ScriptViewer({
  sets,
  onPageTap,
}: {
  sets: ScriptPageSet[];
  onPageTap?: (page: number, x: number, y: number) => void;
}) {
  const [setIndex, setSetIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);

  const set = sets[setIndex];
  if (!set || set.pageIds.length === 0) return null;
  const page = Math.min(pageIndex, set.pageIds.length - 1);
  const pageId = set.pageIds[page];
  const tappable = Boolean(onPageTap) && setIndex === 0;

  const handleTap = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!tappable || !onPageTap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    onPageTap(
      page,
      clamp((e.clientX - rect.left) / rect.width),
      clamp((e.clientY - rect.top) / rect.height)
    );
  };

  return (
    <div className="space-y-3">
      {sets.length > 1 && (
        <div className="flex gap-2" role="tablist">
          {sets.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === setIndex}
              onClick={() => {
                setSetIndex(i);
                setPageIndex(0);
              }}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-2 transition-colors ${
                i === setIndex
                  ? 'bg-blue-950 border-blue-950 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-blue-950'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-bold text-slate-700">
          {sets.length === 1 && <span className="text-slate-500 mr-2">{set.label} ·</span>}
          Page {page + 1} of {set.pageIds.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPageIndex(page - 1)}
            disabled={page === 0}
            className="px-3 py-1 border-2 border-slate-200 font-bold text-slate-700 disabled:opacity-40"
            aria-label="Previous page"
          >
            &larr;
          </button>
          <button
            type="button"
            onClick={() => setPageIndex(page + 1)}
            disabled={page === set.pageIds.length - 1}
            className="px-3 py-1 border-2 border-slate-200 font-bold text-slate-700 disabled:opacity-40"
            aria-label="Next page"
          >
            &rarr;
          </button>
        </div>
      </div>

      <div className="relative w-full border-2 border-slate-200 bg-slate-100">
        <img
          key={pageId}
          src={`/api/scripts/${pageId}`}
          alt={`${set.label} page ${page + 1}`}
          onClick={handleTap}
          className={`block w-full h-auto select-none ${tappable ? 'cursor-crosshair' : ''}`}
          draggable={false}
        />
        {set.pins && <PinOverlay pins={set.pins} page={page} />}
      </div>

      <a
        href={`/api/scripts/${pageId}`}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs font-bold text-blue-700 hover:underline"
      >
        Open page full size &rarr;
      </a>
    </div>
  );
}
