'use client';

/**
 * Round-marking settings, split into two independent fields so each delivery
 * method renders only what it needs:
 *   - MarkingDeadlineField  — paper / hybrid only (when schools must finish
 *                             entering physical marks; parsed as SAST).
 *   - TargetTotalMarksField — ALL delivery methods. This writes the unified
 *                             grading base (rounds.targetTotalMarks) that
 *                             percentages, thresholds and the online draw use.
 *
 * The target field broadcasts its value on a window event so the sibling
 * PublishReadinessPanel / PhysicalPaperSelector islands stay in sync even when
 * their common parent is a server component that cannot hold React state.
 */
export const TARGET_CHANGED_EVENT = 'olympiad:target-changed';

const inputClass =
  'w-full p-3 border border-slate-300 rounded-md text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none';

/** Coerce the raw input into a positive integer, or null when blank/invalid. */
function parseTarget(raw: string): number | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Paper / hybrid rounds: when schools must have entered their physical marks
 * by. Optional; the round actions parse it as SAST wall-clock time.
 */
export function MarkingDeadlineField({
  defaultMarkingClosesAt = '',
}: {
  defaultMarkingClosesAt?: string;
}) {
  return (
    <div>
      <label
        className="block text-sm font-semibold text-slate-900 mb-2"
        htmlFor="markingClosesAt"
      >
        Marking Deadline (SAST)
      </label>
      <input
        type="datetime-local"
        id="markingClosesAt"
        name="markingClosesAt"
        defaultValue={defaultMarkingClosesAt}
        className={inputClass}
      />
      <p className="text-xs text-slate-500 mt-1">
        When schools must have entered physical marks by. Leave empty for 24
        hours after the round closes.
      </p>
    </div>
  );
}

/**
 * Unified target total marks for EVERY delivery method. Online: the exact mark
 * total each dealt variant must fill. Paper / hybrid: the marks obtainable on
 * the paper, used for percentages and mark validation. Writes
 * rounds.targetTotalMarks.
 */
export function TargetTotalMarksField({
  defaultValue,
}: {
  defaultValue?: number | null;
}) {
  const initial = defaultValue ?? '';
  return (
    <div>
      <label
        className="block text-sm font-semibold text-slate-900 mb-2"
        htmlFor="targetTotalMarks"
      >
        Target Total Marks
      </label>
      <input
        type="number"
        id="targetTotalMarks"
        name="targetTotalMarks"
        min="1"
        step="1"
        placeholder="e.g. 100"
        defaultValue={initial}
        onChange={(e) => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent(TARGET_CHANGED_EVENT, {
                detail: { targetTotalMarks: parseTarget(e.target.value) },
              })
            );
          }
        }}
        className={inputClass}
      />
      <p className="text-xs text-slate-500 mt-1">
        The single grading base for this round. Online variants are dealt to
        fill exactly this total; percentages and advancement thresholds are
        measured against it.
      </p>
    </div>
  );
}
