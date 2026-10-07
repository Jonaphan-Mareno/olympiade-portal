'use client';

import { useEffect, useMemo, useState } from 'react';
import { QUESTIONS_CHANGED_EVENT } from '@/components/organiser/QuestionBuilder';
import { TARGET_CHANGED_EVENT } from '@/components/organiser/PaperMarkingFields';

/**
 * Physical-paper picker for paper / hybrid rounds. The organiser hand-picks an
 * ORDERED subset of the round's question pool; that order is the printed paper
 * order and is persisted to questionPapers.selectedQuestionIds. No drag library
 * — plain up/down buttons reorder the selection.
 *
 * The pool is seeded from props (a server component can pass the persisted
 * questions) and then kept live via the QuestionBuilder's window event, so it
 * works whether the parent is a client island (create page) or a server
 * component (edit page). It emits the ordered id array both into a hidden
 * `selectedQuestionIds` input (for the form submit) and onto a window event (so
 * the PublishReadinessPanel can react without a shared React parent).
 */
export const SELECTION_CHANGED_EVENT = 'olympiad:selected-questions-changed';

type PoolSeed = {
  id: string;
  prompt?: string | null;
  type?: string | null;
  questionType?: string | null;
  marks?: number | string | null;
};

type PoolItem = {
  id: string;
  prompt: string;
  type: string;
  marks: number | null;
};

const TYPE_LABELS: Record<string, string> = {
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  true_false: 'True / false',
  matching: 'Matching',
  free_text: 'Free text',
};

function toPoolItem(q: PoolSeed): PoolItem {
  const rawType = q.type ?? q.questionType ?? '';
  const rawMarks = q.marks;
  return {
    id: String(q.id),
    prompt: q.prompt ?? '',
    type: rawType,
    marks:
      rawMarks === '' || rawMarks === null || rawMarks === undefined
        ? null
        : Number(rawMarks),
  };
}

/**
 * Normalize the seed questions into selectable pool items, dropping blank
 * placeholders (no prompt) so an untouched builder question is never printable
 * and the selector matches the pool the server action actually persists.
 */
function normalizePool(seeds: PoolSeed[]): PoolItem[] {
  return seeds
    .map(toPoolItem)
    .filter((it) => it.prompt.trim() !== '');
}

function truncate(text: string, max = 90): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean || '(no prompt)';
}

export default function PhysicalPaperSelector({
  pool = [],
  targetTotalMarks = null,
  initialSelected = [],
}: {
  pool?: PoolSeed[];
  targetTotalMarks?: number | null;
  initialSelected?: string[] | null;
}) {
  const [items, setItems] = useState<PoolItem[]>(() => normalizePool(pool));
  const [selected, setSelected] = useState<string[]>(() =>
    Array.isArray(initialSelected) ? initialSelected.map(String) : []
  );
  const [target, setTarget] = useState<number | null>(targetTotalMarks ?? null);

  // Keep the pool in sync with the live QuestionBuilder (works for both a
  // client parent and a server-component parent). Prune selection to ids that
  // still exist so a removed question cannot linger in the paper.
  useEffect(() => {
    const onQuestions = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questions?: PoolSeed[] };
      const next = normalizePool(detail?.questions ?? []);
      setItems(next);
      const ids = new Set(next.map((n) => n.id));
      setSelected((prev) => prev.filter((id) => ids.has(id)));
    };
    window.addEventListener(QUESTIONS_CHANGED_EVENT, onQuestions as EventListener);
    return () =>
      window.removeEventListener(QUESTIONS_CHANGED_EVENT, onQuestions as EventListener);
  }, []);

  useEffect(() => {
    const onTarget = (e: Event) => {
      const detail = (e as CustomEvent).detail as { targetTotalMarks?: number | null };
      setTarget(detail?.targetTotalMarks ?? null);
    };
    window.addEventListener(TARGET_CHANGED_EVENT, onTarget as EventListener);
    return () =>
      window.removeEventListener(TARGET_CHANGED_EVENT, onTarget as EventListener);
  }, []);

  // Prune the seed selection to the seeded pool on first mount too.
  useEffect(() => {
    const ids = new Set(items.map((i) => i.id));
    setSelected((prev) => (prev.every((id) => ids.has(id)) ? prev : prev.filter((id) => ids.has(id))));
  }, [items]);

  // Broadcast the ordered selection so the readiness panel can react.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(SELECTION_CHANGED_EVENT, {
          detail: { selectedQuestionIds: selected },
        })
      );
    }
  }, [selected]);

  const byId = useMemo(() => {
    const m = new Map<string, PoolItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const selectedTotal = useMemo(
    () =>
      selected.reduce((sum, id) => {
        const it = byId.get(id);
        return sum + (it && typeof it.marks === 'number' && Number.isFinite(it.marks) ? it.marks : 0);
      }, 0),
    [selected, byId]
  );

  const matchesTarget =
    typeof target === 'number' && Number.isFinite(target) && target > 0 && selectedTotal === target;

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) =>
      checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)
    );
  };

  const move = (id: string, dir: -1 | 1) => {
    setSelected((prev) => {
      const idx = prev.indexOf(id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-serif text-2xl font-bold text-blue-950">
            Physical Paper Selection
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            Tick the questions to print, then use the arrows to set their order
            on the paper.
          </p>
        </div>
        <div
          aria-live="polite"
          className={`text-sm font-semibold px-4 py-2 rounded-md border ${
            matchesTarget
              ? 'bg-green-50 border-green-300 text-green-800'
              : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}
        >
          <span data-testid="selected-total">Selected total: {selectedTotal} marks</span>
          {typeof target === 'number' && target > 0 && (
            <span className="block text-xs font-normal opacity-80">
              Target: {target} marks
            </span>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          Add questions in the builder above, then select the ones for this paper.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const order = selected.indexOf(it.id);
            const isSelected = order >= 0;
            return (
              <li
                key={it.id}
                data-question-id={it.id}
                className={`flex items-center gap-3 rounded-md border p-3 ${
                  isSelected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${truncate(it.prompt, 40)}`}
                  checked={isSelected}
                  onChange={(e) => toggle(it.id, e.target.checked)}
                  className="w-4 h-4 text-blue-600 cursor-pointer shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-900 truncate">{truncate(it.prompt)}</p>
                  <p className="text-xs text-slate-500">
                    {TYPE_LABELS[it.type] ?? it.type ?? 'Question'}
                    {' · '}
                    {it.marks === null ? 'no marks' : `${it.marks} marks`}
                  </p>
                </div>
                {isSelected && (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs font-semibold text-blue-800 w-6 text-center">
                      #{order + 1}
                    </span>
                    <button
                      type="button"
                      aria-label="Move up"
                      onClick={() => move(it.id, -1)}
                      disabled={order === 0}
                      className="px-2 py-1 text-slate-600 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-100"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      onClick={() => move(it.id, 1)}
                      disabled={order === selected.length - 1}
                      className="px-2 py-1 text-slate-600 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-100"
                    >
                      ↓
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <input
        type="hidden"
        name="selectedQuestionIds"
        value={JSON.stringify(selected)}
      />
    </div>
  );
}
