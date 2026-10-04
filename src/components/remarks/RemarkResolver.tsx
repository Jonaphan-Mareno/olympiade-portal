'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { QuestionMark } from '@/domain/remarks/remarks';
import { submitRemarkResolution } from './actions';

/**
 * Re-marking form. Online papers are re-marked question by question,
 * starting from the current marks; paper scripts get a new total.
 */
export default function RemarkResolver({
  requestId,
  mode,
  questions,
  currentScore,
  doneHref,
}: {
  requestId: string;
  mode: 'online' | 'paper';
  questions: QuestionMark[];
  currentScore: number | null;
  doneHref: string;
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.questionId, String(q.marks)]))
  );
  const [newTotal, setNewTotal] = useState(currentScore !== null ? String(currentScore) : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const maxTotal = questions.reduce((sum, q) => sum + q.maxMarks, 0);
  const onlineTotal =
    Math.round(
      questions.reduce((sum, q) => sum + (Number(marks[q.questionId]) || 0), 0) * 100
    ) / 100;
  const proposed = mode === 'online' ? onlineTotal : Number(newTotal);

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const res = await submitRemarkResolution({
        requestId,
        note,
        ...(mode === 'online'
          ? {
              questionMarks: Object.fromEntries(
                Object.entries(marks).map(([id, v]) => [id, Number(v)])
              ),
            }
          : { newTotal: Number(newTotal) }),
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(doneHref);
    });
  };

  return (
    <div className="space-y-6 text-slate-900">
      {mode === 'online' ? (
        <div className="space-y-4">
          {questions.map((q) => {
            const value = marks[q.questionId];
            const changed = Number(value) !== q.marks;
            return (
              <div
                key={q.questionId}
                className={`bg-white border rounded-lg p-5 ${changed ? 'border-amber-400' : 'border-slate-200'}`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Question {q.number} · {q.questionType.replace('_', ' ')}
                    </div>
                    <p className="font-medium text-slate-900 mb-3">{q.prompt}</p>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="bg-slate-50 border border-slate-200 rounded p-2">
                        <dt className="text-xs font-semibold text-slate-500">Entrant&apos;s answer</dt>
                        <dd className="whitespace-pre-wrap break-words">{q.studentAnswer}</dd>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded p-2">
                        <dt className="text-xs font-semibold text-slate-500">Answer key</dt>
                        <dd className="whitespace-pre-wrap break-words">{q.correctAnswer}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="shrink-0">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Marks (was {q.marks})
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={q.maxMarks}
                        step={0.5}
                        value={value}
                        onChange={(e) =>
                          setMarks((m) => ({ ...m, [q.questionId]: e.target.value }))
                        }
                        className="w-20 p-2 border border-slate-300 rounded bg-white text-slate-900"
                      />
                      <span className="text-sm text-slate-600">/ {q.maxMarks}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-sm text-slate-700 mb-4">
            Re-mark the entrant&apos;s physical script against the memo, then enter
            the new total. If the script was uploaded, it is linked above.
          </p>
          <label className="block text-sm font-semibold mb-1">Remarked total</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={0.5}
              value={newTotal}
              onChange={(e) => setNewTotal(e.target.value)}
              className="w-28 p-2 border border-slate-300 rounded bg-white text-slate-900"
            />
            {maxTotal > 0 && <span className="text-sm text-slate-600">/ {maxTotal}</span>}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="text-sm">
          Current mark: <strong>{currentScore ?? '—'}</strong>
          {' → '}New mark:{' '}
          <strong className={proposed !== currentScore ? 'text-amber-700' : ''}>
            {Number.isFinite(proposed) ? proposed : '—'}
          </strong>
          {mode === 'online' && <> / {maxTotal}</>}
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">
            Outcome for the entrant <span className="text-red-600">*</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="E.g. Question 4 accepted — your method is valid. Other marks confirmed."
            className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900 placeholder:text-slate-400"
          />
        </div>
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-bold py-2 px-6 rounded"
          >
            {isPending ? 'Saving…' : 'Complete remark'}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          The new mark replaces the old one in the standings, rankings and
          certificates, and the entrant is notified.
        </p>
      </div>
    </div>
  );
}
