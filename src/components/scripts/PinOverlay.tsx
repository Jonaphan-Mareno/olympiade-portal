import type { ScriptPin } from '@/domain/scripts/script-rules';

// Read-only numbered pins on a script page, and their notes. Shared by the
// entrant's results page, their appeal form and the remark review screens so
// everyone sees the same numbers in the same places. A pin's number is its
// position in the full list, across pages.

export function PinOverlay({ pins, page }: { pins: ScriptPin[]; page: number }) {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {pins.map((pin, i) =>
        pin.page === page ? (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-amber-400 border-2 border-amber-950 text-amber-950 text-xs font-bold flex items-center justify-center shadow"
            style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
          >
            {i + 1}
          </span>
        ) : null
      )}
    </div>
  );
}

export function PinNotes({ pins }: { pins: ScriptPin[] }) {
  if (pins.length === 0) return null;
  return (
    <ol className="space-y-2 text-sm">
      {pins.map((pin, i) => (
        <li key={i} className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-amber-400 border-2 border-amber-950 text-amber-950 text-xs font-bold flex items-center justify-center">
            {i + 1}
          </span>
          <span className="text-slate-800">
            <span className="text-slate-500 font-medium">Page {pin.page + 1}</span>
            {pin.note ? <> · {pin.note}</> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
