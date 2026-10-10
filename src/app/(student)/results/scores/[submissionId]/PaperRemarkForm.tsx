'use client';

import { useState } from 'react';
import {
  MAX_PIN_NOTE_LENGTH,
  MAX_PINS,
  MAX_QUESTION_REFS_LENGTH,
  type ScriptPin,
} from '@/domain/scripts/script-rules';
import ScriptViewer from '@/components/scripts/ScriptViewer';
import { requestStudentRemark } from './actions';

/**
 * Appeal form for a paper script: the questions concerned, the reason, and
 * optional numbered pins dropped on the entrant's marked pages.
 */
export default function PaperRemarkForm({
  submissionId,
  pageIds,
  onClose,
}: {
  submissionId: string;
  pageIds: string[];
  onClose: () => void;
}) {
  const [questionRefs, setQuestionRefs] = useState('');
  const [reason, setReason] = useState('');
  const [pins, setPins] = useState<ScriptPin[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addPin = (page: number, x: number, y: number) => {
    if (pins.length >= MAX_PINS) {
      setError(`You can add at most ${MAX_PINS} pins.`);
      return;
    }
    setError(null);
    setPins((prev) => [...prev, { page, x, y, note: '' }]);
  };

  const updateNote = (index: number, note: string) =>
    setPins((prev) => prev.map((p, i) => (i === index ? { ...p, note } : p)));

  const removePin = (index: number) => setPins((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide a reason for the remark request.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    const result = await requestStudentRemark(submissionId, reason, { questionRefs, pins });
    setIsSubmitting(false);

    if (result.success) {
      onClose();
    } else {
      setError(result.error || 'Failed to submit request');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-none border-2 border-slate-200 shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b-2 border-slate-200 bg-slate-50">
          <h3 className="text-lg font-bold text-blue-950 font-serif">Request a Remark</h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <p className="text-sm text-slate-600 font-medium">
            Tell your school which questions you think were marked incorrectly and
            why.{pageIds.length > 0 && ' You can also tap your script to pin the exact spot, with a short note.'}
          </p>

          <div>
            <label htmlFor="questionRefs" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Question(s)
            </label>
            <input
              id="questionRefs"
              type="text"
              maxLength={MAX_QUESTION_REFS_LENGTH}
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-none focus:outline-none focus:border-blue-950"
              placeholder="E.g., Q3, Q5b"
              value={questionRefs}
              onChange={(e) => setQuestionRefs(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="reason" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Reason for Request <span className="text-amber-500">*</span>
            </label>
            <textarea
              id="reason"
              rows={4}
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-none focus:outline-none focus:border-blue-950"
              placeholder="E.g., In Q3 my working is correct but only 1 of 3 marks was given..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {pageIds.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Pins (optional, up to {MAX_PINS}) — tap the page to add one
              </div>
              <ScriptViewer
                sets={[{ key: 'original', label: 'Your script', pageIds, pins }]}
                onPageTap={isSubmitting ? undefined : addPin}
              />
              {pins.length > 0 && (
                <ol className="space-y-3">
                  {pins.map((pin, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="shrink-0 mt-2 w-7 h-7 rounded-full bg-amber-400 border-2 border-amber-950 text-amber-950 text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <label htmlFor={`pin-note-${i}`} className="block text-xs font-medium text-slate-500 mb-1">
                          Page {pin.page + 1} note
                        </label>
                        <input
                          id={`pin-note-${i}`}
                          type="text"
                          maxLength={MAX_PIN_NOTE_LENGTH}
                          value={pin.note}
                          onChange={(e) => updateNote(i, e.target.value)}
                          disabled={isSubmitting}
                          placeholder="What should the marker look at here?"
                          className="w-full px-3 py-2 border-2 border-slate-200 rounded-none focus:outline-none focus:border-blue-950 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removePin(i)}
                        disabled={isSubmitting}
                        className="mt-7 text-xs font-bold text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-sm font-bold border-l-4 border-red-500">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-4 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-6 py-3 text-sm font-bold text-slate-700 uppercase tracking-wider hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-blue-950 hover:bg-blue-900 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
